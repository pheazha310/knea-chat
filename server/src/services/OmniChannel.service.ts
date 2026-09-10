/**
 * OmniChannelService — channel-agnostic engine for the omni-channel inbox.
 *
 * Every external channel (Telegram now, WhatsApp / email / … later) plugs in as
 * a `ChannelAdapter`; this service owns everything the adapters share:
 *
 *   inbound  → parse (adapter) → contact → conversation → message → MySQL
 *              → notifications → WebSocket
 *   outbound → resolve chat id from the stored contact → adapter.sendMessage
 *              → persist only on delivery success → broadcast
 *
 * No provider-specific code lives here — Telegram specifics live in
 * `integrations/telegram/telegram.adapter.ts` (and a future channel would add
 * its own adapter under `integrations/<channel>/`).
 *
 * External identities (provider contact/message ids) are stored in the
 * external_* tables and are never treated as internal user ids.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import type { ExternalContactRow, ExternalConversationRow, OutgoingMessage } from '../types';
import type { ChannelAdapter, OmniInboundMessage, OmniMedia } from '../integrations/omni/omni.types';
import type { ChannelRegistry } from '../integrations/omni/channelRegistry';
import type { ExternalContactRepository } from '../repositories/externalContactRepository';
import type { UserRepository } from '../repositories/userRepository';
import type { CompanyRepository } from '../repositories/companyRepository';
import type { ConversationRepository } from '../repositories/conversationRepository';
import type { MessageRepository } from '../repositories/messageRepository';
import type { MessageService } from './Message.service';
import type { BroadcastToConversation } from '../websocket/broadcast.utils';
import { serializeMessage } from '../websocket/message.utils';
import { sendToUser } from '../websocket/connection.registry';
import { badRequest } from '../utils/errors.utils';

/** Company domain that hosts external-contact shadow users (see migration 024). */
const EXTERNAL_COMPANY_DOMAIN = 'omni-channel.external';

const snippetOf = (text: string): string =>
  text.length > 120 ? `${text.slice(0, 120)}…` : text;

/** Title-case a channel key for display ('telegram' → 'Telegram'). */
const channelLabel = (channel: string): string =>
  channel.charAt(0).toUpperCase() + channel.slice(1);

/** Contact display name used as the internal conversation name. */
const contactName = (contact: {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}): string => {
  const full = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  return full || contact.username || 'External Customer';
};

/** A channel send that the provider refused (HTTP 502 to the client). */
const deliveryError = (description: string): Error =>
  Object.assign(new Error(description || 'Channel delivery failed'), { statusCode: 502 });

export class OmniChannelService {
  constructor(
    private registry: ChannelRegistry,
    private externalRepository: ExternalContactRepository,
    private userRepository: UserRepository,
    private companyRepository: CompanyRepository,
    private conversationRepository: ConversationRepository,
    private messageRepository: MessageRepository,
    private messageService: MessageService,
    private broadcastToConversation: BroadcastToConversation,
  ) {}

  // ---------------------------------------------------------------------------
  // Inbound webhook processing
  // ---------------------------------------------------------------------------

  /**
   * Process a raw webhook payload for a channel. Returns how many messages
   * were persisted vs ignored (unsupported updates / duplicates). Never throws
   * for ignorable updates.
   */
  async processInbound(
    channel: string,
    payload: unknown,
  ): Promise<{ processed: number; ignored: number }> {
    const adapter = this.requireAdapter(channel);
    const messages = await adapter.parseInbound(payload);

    let processed = 0;
    let ignored = 0;
    for (const message of messages) {
      try {
        const persisted = await this.processInboundMessage(channel, adapter, message);
        if (persisted) {
          processed += 1;
        } else {
          ignored += 1;
        }
      } catch (error) {
        // One bad message must never break the rest of the batch.
        console.error(
          `[omni:${channel}] Failed to process message ${message.externalMessageId}:`,
          (error as Error).message,
        );
        ignored += 1;
      }
    }
    return { processed, ignored };
  }

  /** Persist one normalized inbound message (find-or-create → store → broadcast). */
  private async processInboundMessage(
    channel: string,
    adapter: ChannelAdapter,
    message: OmniInboundMessage,
  ): Promise<OutgoingMessage | null> {
    const contact = await this.findOrCreateContact(channel, message);
    const externalConversation = await this.findOrCreateConversation(channel, contact);
    const persisted = await this.createInboundMessage(
      channel,
      adapter,
      externalConversation.conversation_id,
      contact,
      message,
    );
    if (persisted) {
      await this.broadcastInboundMessage(channel, externalConversation.conversation_id, persisted);
    }
    return persisted;
  }

  /**
   * Find the external contact for a provider contact id; create the shadow
   * user + contact row on first sight. The provider id is stored in
   * external_contacts.external_contact_id — never as an internal user id.
   */
  async findOrCreateContact(
    channel: string,
    message: OmniInboundMessage,
  ): Promise<ExternalContactRow> {
    const externalId = String(message.externalContactId);
    const existing = await this.externalRepository.findByChannelAndExternalId(channel, externalId);
    if (existing) return existing;

    // Shadow user backing the contact (required by the users-table FKs).
    const company = await this.companyRepository.findByDomain(EXTERNAL_COMPANY_DOMAIN);
    if (!company) {
      throw new Error(
        `Omni-channel company "${EXTERNAL_COMPANY_DOMAIN}" is missing — run migration 024`,
      );
    }
    const password = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
    const userId = await this.userRepository.create({
      company_id: company.id,
      email: `${channel}.${externalId}@external.kneachat.local`,
      password,
      first_name: message.firstName || channelLabel(channel),
      last_name: message.lastName || 'Customer',
      role: 'external',
    });

    const contactId = await this.externalRepository.createContact({
      user_id: userId,
      channel,
      external_contact_id: externalId,
      username: message.username || null,
      first_name: message.firstName || null,
      last_name: message.lastName || null,
      metadata: message.metadata ?? null,
    });

    return {
      id: contactId,
      user_id: userId,
      channel,
      external_contact_id: externalId,
      username: message.username || null,
      first_name: message.firstName || null,
      last_name: message.lastName || null,
      metadata: message.metadata ?? null,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  /**
   * Find the contact's conversation for a channel; create it on first contact.
   * One conversation per contact+channel is reused for every subsequent
   * message. Internal users are joined so the conversation shows up in the
   * Omni Inbox. A closed conversation is reopened on new inbound activity.
   */
  async findOrCreateConversation(
    channel: string,
    contact: ExternalContactRow,
  ): Promise<ExternalConversationRow> {
    const existing = await this.externalRepository.findConversationByContact(channel, contact.id);
    if (existing) {
      if (existing.status === 'closed') {
        await this.externalRepository.updateConversationStatus(existing.conversation_id, 'open');
        return { ...existing, status: 'open' };
      }
      return existing;
    }

    const name = `${contactName(contact)} (${channelLabel(channel)})`;
    const conversationId = await this.conversationRepository.create({
      type: 'direct',
      created_by: contact.user_id,
      name,
      description: `${channelLabel(channel)} conversation`,
    });

    await this.conversationRepository.addMember(conversationId, contact.user_id, 'member');
    await this.joinInboxAgents(conversationId);

    const externalConversationId = await this.externalRepository.createConversation({
      conversation_id: conversationId,
      contact_id: contact.id,
      channel,
      status: 'open',
    });

    return {
      id: externalConversationId,
      conversation_id: conversationId,
      contact_id: contact.id,
      channel,
      status: 'open',
      assigned_agent_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  /**
   * Join the agents who should see omni-channel inbox conversations. Defaults
   * to every internal user (role != 'external'); OMNI_INBOX_AGENT_IDS (or the
   * legacy TELEGRAM_INBOX_AGENT_IDS) restricts the inbox to specific users.
   */
  private async joinInboxAgents(conversationId: number): Promise<void> {
    const override = (process.env.OMNI_INBOX_AGENT_IDS || process.env.TELEGRAM_INBOX_AGENT_IDS || '')
      .split(',')
      .map((v) => parseInt(v.trim(), 10))
      .filter((v) => Number.isFinite(v) && v > 0);
    const agentIds = override.length > 0 ? override : await this.userRepository.findInternalUserIds();

    for (const agentId of agentIds) {
      try {
        if (!(await this.conversationRepository.isMember(conversationId, agentId))) {
          await this.conversationRepository.addMember(conversationId, agentId, 'member');
        }
      } catch (error) {
        // A failing member insert must never block the conversation creation.
        console.error(
          `[omni] Could not join agent ${agentId} to conversation ${conversationId}:`,
          (error as Error).message,
        );
      }
    }
  }

  /**
   * Persist an inbound message (internal `messages` row + external ledger +
   * optional attachment). Duplicate redeliveries are detected by the unique
   * (channel, external_message_id) key and skipped.
   */
  async createInboundMessage(
    channel: string,
    adapter: ChannelAdapter,
    conversationId: number,
    contact: ExternalContactRow,
    message: OmniInboundMessage,
  ): Promise<OutgoingMessage | null> {
    const externalMessageId = String(message.externalMessageId);
    const duplicate = await this.externalRepository.findMessageByExternalId(
      channel,
      externalMessageId,
    );
    if (duplicate) {
      console.log(`[omni:${channel}] Duplicate inbound message ${externalMessageId} ignored`);
      return null;
    }

    const content = message.content || '';
    const stored = message.media ? await this.downloadAndStoreMedia(channel, adapter, message.media) : null;

    let messageId: number;
    try {
      messageId = await this.messageRepository.create({
        conversation_id: conversationId,
        sender_id: contact.user_id,
        content,
        type: message.media?.kind ?? 'text',
        reply_to: null,
      });
    } catch (error) {
      // Race between two webhook deliveries — treat as already-processed.
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        return null;
      }
      throw error;
    }

    if (stored) {
      await this.messageRepository.createAttachment({
        message_id: messageId,
        file_name: stored.fileName,
        file_url: stored.fileUrl,
        file_type: message.media?.mimeType ?? null,
        file_size: stored.fileSize,
      });
    }

    try {
      await this.externalRepository.createMessage({
        message_id: messageId,
        conversation_id: conversationId,
        external_message_id: externalMessageId,
        channel,
        direction: 'inbound',
        sender_type: 'customer',
        content,
        external_timestamp: message.externalTimestamp ?? null,
        metadata: this.inboundMetadata(message),
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        console.log(`[omni:${channel}] Duplicate inbound message ${externalMessageId} ignored (race)`);
        return null;
      }
      throw error;
    }

    const persisted = (await this.messageRepository.findByIdWithSender(messageId)) as OutgoingMessage;
    persisted.reactions = [];
    persisted.attachments = stored
      ? await this.messageRepository.findAttachments(messageId)
      : [];

    // Unread-badge notifications for the inbox agents (respects preferences).
    persisted.notifiedUserIds = await this.messageService.createMessageNotifications(
      persisted,
      contact.user_id,
      conversationId,
      content,
      [],
    );
    return persisted;
  }

  /** Merge channel metadata + media reference into the external ledger row. */
  private inboundMetadata(message: OmniInboundMessage): unknown {
    const base = (message.metadata as Record<string, unknown> | null) || {};
    if (!message.media) return base;
    return {
      ...base,
      media: { kind: message.media.kind, file_ref: message.media.fileRef },
    };
  }

  /**
   * Download a media file through the channel adapter and store it under the
   * shared uploads directory. Returns null when the channel cannot provide
   * the file (the message is still recorded so agents see it, minus the file).
   */
  private async downloadAndStoreMedia(
    channel: string,
    adapter: ChannelAdapter,
    media: OmniMedia,
  ): Promise<{ fileUrl: string; fileName: string; fileSize: number | null } | null> {
    if (!adapter.downloadMedia) return null;
    try {
      const buffer = await adapter.downloadMedia(media);
      if (!buffer) {
        console.warn(`[omni:${channel}] Could not download media ${media.fileRef}`);
        return null;
      }

      const uploadDir = path.join(
        __dirname,
        '..',
        '..',
        process.env.UPLOAD_DIR || 'uploads',
      );
      fs.mkdirSync(uploadDir, { recursive: true });
      const ext = path.extname(media.fileName).toLowerCase();
      const base = path
        .basename(media.fileName, ext)
        .replace(/[^a-zA-Z0-9-_]/g, '_')
        .slice(0, 60);
      const storedName = `${Date.now()}-${Math.round(Math.random() * 1e6)}-${base}${ext}`;
      fs.writeFileSync(path.join(uploadDir, storedName), buffer);

      return { fileUrl: `/uploads/${storedName}`, fileName: media.fileName, fileSize: buffer.length };
    } catch (error) {
      console.error(`[omni:${channel}] Media download failed:`, (error as Error).message);
      return null;
    }
  }

  /** Fan the inbound message out to the inbox agents (existing WS conventions). */
  private async broadcastInboundMessage(
    channel: string,
    conversationId: number,
    message: OutgoingMessage,
  ): Promise<void> {
    await this.broadcastToConversation(conversationId, {
      type: 'receive_message',
      message: serializeMessage(message),
      channel,
    });
    this.notifyMembers(message, conversationId, message.notifiedUserIds || []);
  }

  // ---------------------------------------------------------------------------
  // Outbound agent reply
  // ---------------------------------------------------------------------------

  /**
   * Send an agent reply to the external customer through the conversation's
   * channel adapter. The provider chat id is resolved server-side from the
   * stored contact — the client only supplies the conversation id. The
   * message is persisted only after the channel confirms delivery.
   */
  async sendAgentReply(
    conversationId: number,
    agentId: number,
    text: string,
    replyToMessageId?: number | null,
  ): Promise<OutgoingMessage> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw badRequest('Message text is required');
    }

    const conversation = await this.conversationRepository.findById(conversationId);
    if (!conversation) {
      throw badRequest('Conversation not found');
    }

    const external = await this.externalRepository.findConversationWithContact(conversationId);
    if (!external) {
      throw badRequest('This conversation is not an external channel conversation');
    }

    const isMember = await this.conversationRepository.isMember(conversationId, agentId);
    if (!isMember) {
      throw badRequest('You are not a member of this conversation');
    }

    const adapter = this.requireAdapter(external.channel);
    const chatId = Number(external.external_contact_id);
    if (!Number.isFinite(chatId) || chatId <= 0) {
      throw new Error(`Invalid chat id for channel ${external.channel}`);
    }

    // `replyToMessageId` is an INTERNAL messages.id; the channel needs its own
    // message id, so map it through the external ledger (ignored when unknown).
    let replyToExternalMessageId: string | null = null;
    if (replyToMessageId) {
      const replyTarget = await this.messageRepository.findById(replyToMessageId);
      if (replyTarget && Number(replyTarget.conversation_id) === conversationId) {
        const replyExternal = await this.externalRepository.findByMessageId(replyToMessageId);
        replyToExternalMessageId = replyExternal?.external_message_id || null;
      }
    }

    // Deliver through the channel first — only persist on success.
    const sent = await adapter.sendMessage(chatId, trimmed, { replyToExternalMessageId });
    if (!sent.ok) {
      throw deliveryError(sent.description ?? 'Channel delivery failed');
    }

    const messageId = await this.messageRepository.create({
      conversation_id: conversationId,
      sender_id: agentId,
      content: trimmed,
      type: 'text',
      reply_to: null,
    });
    await this.externalRepository.createMessage({
      message_id: messageId,
      conversation_id: conversationId,
      external_message_id: sent.externalMessageId || null,
      channel: external.channel,
      direction: 'outbound',
      sender_type: 'agent',
      content: trimmed,
      external_timestamp: new Date(),
      metadata: sent.externalMessageId
        ? { [external.channel]: { message_id: sent.externalMessageId } }
        : null,
    });

    const message = (await this.messageRepository.findByIdWithSender(messageId)) as OutgoingMessage;
    message.reactions = [];
    message.attachments = [];
    message.notifiedUserIds = await this.messageService.createMessageNotifications(
      message,
      agentId,
      conversationId,
      trimmed,
      [],
    );

    // Sync the reply to every other inbox member (the sender gets the REST
    // response directly, mirroring the message-handler ack convention).
    await this.broadcastToConversation(
      conversationId,
      { type: 'receive_message', message: serializeMessage(message), channel: external.channel },
      { excludeUserId: agentId },
    );
    this.notifyMembers(message, conversationId, message.notifiedUserIds || []);

    return message;
  }

  /** Push real-time notification events to members (same shape as chat). */
  private notifyMembers(
    message: OutgoingMessage,
    conversationId: number,
    memberIds: number[],
  ): void {
    const senderName =
      [message.first_name, message.last_name].filter(Boolean).join(' ').trim() || 'Someone';
    for (const memberId of memberIds) {
      sendToUser(Number(memberId), JSON.stringify({
        type: 'notification',
        data: {
          type: 'new_message',
          title: senderName,
          message: snippetOf(message.content),
          conversationId: Number(conversationId),
          messageId: message.id,
        },
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // Assignment + status
  // ---------------------------------------------------------------------------

  /**
   * Assign (or unassign, agentId = null) an agent to an external conversation.
   * The requester must be a member; the assignee must be a member too.
   */
  async assignAgent(
    conversationId: number,
    requesterId: number,
    agentId: number | null,
  ): Promise<{ conversationId: number; assignedAgentId: number | null }> {
    const external = await this.externalRepository.findByConversationId(conversationId);
    if (!external) {
      throw badRequest('This conversation is not an external channel conversation');
    }

    const requesterIsMember = await this.conversationRepository.isMember(conversationId, requesterId);
    if (!requesterIsMember) {
      throw badRequest('You are not a member of this conversation');
    }

    if (agentId !== null) {
      const assigneeIsMember = await this.conversationRepository.isMember(conversationId, agentId);
      if (!assigneeIsMember) {
        throw badRequest('The assigned agent is not a member of this conversation');
      }
    }

    await this.externalRepository.updateAssignedAgent(conversationId, agentId);

    // Live-sync the assignment to every inbox member.
    await this.broadcastToConversation(conversationId, {
      type: 'omni_assignment_changed',
      data: { conversationId, assignedAgentId: agentId },
    });

    return { conversationId, assignedAgentId: agentId };
  }

  /**
   * Set an external conversation's inbox status ('open' / 'closed'). The
   * requester must be a member. Reopening is automatic on new inbound traffic.
   */
  async setConversationStatus(
    conversationId: number,
    requesterId: number,
    status: 'open' | 'closed',
  ): Promise<{ conversationId: number; status: 'open' | 'closed' }> {
    const external = await this.externalRepository.findByConversationId(conversationId);
    if (!external) {
      throw badRequest('This conversation is not an external channel conversation');
    }

    const isMember = await this.conversationRepository.isMember(conversationId, requesterId);
    if (!isMember) {
      throw badRequest('You are not a member of this conversation');
    }

    await this.externalRepository.updateConversationStatus(conversationId, status);

    await this.broadcastToConversation(conversationId, {
      type: 'omni_conversation_status_changed',
      data: { conversationId, status },
    });

    return { conversationId, status };
  }

  // ---------------------------------------------------------------------------
  // Health + webhook administration (delegated to the channel adapter)
  // ---------------------------------------------------------------------------

  /** True when a conversation is backed by an external channel. */
  async isExternalConversation(conversationId: number): Promise<boolean> {
    return !!(await this.externalRepository.findByConversationId(conversationId));
  }

  /** Channel health: configured + reachable? */
  async getHealth(channel: string): Promise<{ channel: string; connected: boolean; info?: Record<string, unknown> }> {
    const adapter = this.requireAdapter(channel);
    const health = await adapter.getHealth();
    return { channel, connected: health.connected, info: health.info };
  }

  async setupWebhook(channel: string, webhookUrl: string): Promise<unknown> {
    const adapter = this.requireAdapter(channel);
    if (!adapter.setupWebhook) {
      throw badRequest(`Channel ${channel} does not support webhook administration`);
    }
    return adapter.setupWebhook(webhookUrl);
  }

  async getWebhookInfo(channel: string): Promise<unknown> {
    const adapter = this.requireAdapter(channel);
    if (!adapter.getWebhookInfo) {
      throw badRequest(`Channel ${channel} does not support webhook administration`);
    }
    return adapter.getWebhookInfo();
  }

  async deleteWebhook(channel: string): Promise<unknown> {
    const adapter = this.requireAdapter(channel);
    if (!adapter.deleteWebhook) {
      throw badRequest(`Channel ${channel} does not support webhook administration`);
    }
    return adapter.deleteWebhook();
  }

  /** Registered channel keys. */
  channels(): string[] {
    return this.registry.channels();
  }

  private requireAdapter(channel: string): ChannelAdapter {
    const adapter = this.registry.get(channel);
    if (!adapter) {
      throw badRequest(`Unknown channel: ${channel}`);
    }
    return adapter;
  }
}