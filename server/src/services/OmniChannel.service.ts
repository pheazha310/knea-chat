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
 *              (email: persist 'pending' → send → 'sent' | 'failed', see
 *              sendEmailWithStatus)
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
import { resolveUploadDir } from '../utils/uploads';
import type { ExternalContactRow, ExternalConversationRow, OutgoingMessage } from '../types';
import type {
  ChannelAdapter,
  OmniInboundMessage,
  OmniMedia,
  OmniOutboundResult,
  OmniOutboundThreading,
} from '../integrations/omni/omni.types';
import type { OmniOutboundMedia } from '../integrations/omni/omni.types';
import {
  buildReplySubject,
  generateMessageId,
  getFromAddress,
  normalizeMessageId,
} from '../integrations/email/email.service';
import type { EmailMessageRepository } from '../repositories/emailMessageRepository';
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

/** WebSocket event for a new customer email in the Omni Inbox. */
export const EMAIL_MESSAGE_RECEIVED = 'email.message.received';

/** Company domain that hosts external-contact shadow users (see migration 024). */
const EXTERNAL_COMPANY_DOMAIN = 'omni-channel.external';

const snippetOf = (text: string): string =>
  text.length > 120 ? `${text.slice(0, 120)}…` : text;

/** Title-case a channel key for display ('telegram' → 'Telegram'). */
const channelLabel = (channel: string): string =>
  channel.charAt(0).toUpperCase() + channel.slice(1);

/**
 * Subject of an inbound email (from the adapter metadata), used as the
 * conversation name for new threads. Returns null for other channels or when
 * the subject is missing — callers then fall back to the contact name.
 */
const extractEmailSubject = (message?: OmniInboundMessage): string | null => {
  const emailMeta = ((message?.metadata as { email?: { subject?: unknown } } | null) || {})?.email;
  const subject = typeof emailMeta?.subject === 'string' ? emailMeta.subject.trim() : '';
  return subject ? subject.slice(0, 120) : null;
};

/** Normalized Message-ID list from a References header (string or array). */
const normalizeReferences = (references: unknown): string[] => {
  const raw = Array.isArray(references)
    ? references.map(String)
    : typeof references === 'string'
      ? references.split(/\s+/)
      : [];
  return [...new Set(raw.map((id) => normalizeMessageId(id)).filter((id): id is string => !!id))];
};

/** Bare address from an RFC 5322 mailbox (`Name <a@b.c>` → `a@b.c`). */
const bareAddress = (mailbox: unknown): string | null => {
  if (typeof mailbox !== 'string' || !mailbox.trim()) return null;
  const match = mailbox.match(/<([^>]+)>/);
  return (match ? match[1] : mailbox).trim().toLowerCase();
};

/** Contact display name used as the internal conversation name. */
const contactName = (contact: {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}): string => {
  const full = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  return full || contact.username || 'External Customer';
};

/**
 * Longest agent reply accepted. The JSON body limit is 10 MB; without this a
 * single request could store and email megabytes of text.
 */
export const MAX_REPLY_LENGTH = 20000;

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
    // Email threading + delivery-status ledger (migration 031). Optional so
    // non-email deployments and unit tests can omit it; without it email
    // falls back to the legacy deliver-then-persist path.
    private emailMessages?: EmailMessageRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Inbound webhook processing
  // ---------------------------------------------------------------------------

  /**
   * Process a raw webhook payload for a channel. Returns how many messages
   * were persisted, ignored (unsupported updates / duplicates) or failed
   * (unexpected error, e.g. the database is down — the caller should make the
   * provider retry). Never throws for ignorable updates.
   */
  async processInbound(
    channel: string,
    payload: unknown,
  ): Promise<{ processed: number; ignored: number; failed: number }> {
    const adapter = this.requireAdapter(channel);
    const messages = await adapter.parseInbound(payload);

    let processed = 0;
    let ignored = 0;
    let failed = 0;
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
        failed += 1;
      }
    }
    return { processed, ignored, failed };
  }

  /** Persist one normalized inbound message (find-or-create → store → broadcast). */
  private async processInboundMessage(
    channel: string,
    adapter: ChannelAdapter,
    message: OmniInboundMessage,
  ): Promise<OutgoingMessage | null> {
    const contact = await this.findOrCreateContact(channel, message);
    const externalConversation = await this.findOrCreateConversation(channel, contact, message, adapter);
    const persisted = await this.createInboundMessage(
      channel,
      adapter,
      externalConversation.conversation_id,
      contact,
      message,
    );
    if (persisted) {
      await this.broadcastInboundMessage(channel, externalConversation.conversation_id, persisted, message);
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
    if (existing) {
      // Some providers expose a sender's display name only on a later email.
      // Update the existing shadow contact when that name becomes available.
      if (channel === 'email' && message.firstName) {
        await this.externalRepository.updateContactIdentity(existing.id, {
          username: String(message.username || externalId),
          firstName: message.firstName,
          lastName: message.lastName || null,
        });
        await this.userRepository.update(existing.user_id, {
          first_name: message.firstName,
          last_name: message.lastName || 'Customer',
        });
        existing.username = String(message.username || externalId);
        existing.first_name = message.firstName;
        existing.last_name = message.lastName || null;
      }
      return existing;
    }

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
   *
   * Email threads the conversation by RFC 5322 headers: when the adapter
   * supplies thread hints (In-Reply-To / References), the referenced Message-
   * IDs are matched against the external ledger and the message joins that
   * thread's conversation. An unknown chain starts a NEW conversation (named
   * after the email subject) so two unrelated threads from the same customer
   * stay separate. Channels without threading (or emails without headers —
   * e.g. a brand-new thread) fall back to the contact's most recent
   * conversation, which is reused for every subsequent message.
   *
   * Internal users are joined so the conversation shows up in the Omni Inbox.
   * A closed conversation is reopened on new inbound activity.
   */
  async findOrCreateConversation(
    channel: string,
    contact: ExternalContactRow,
    message?: OmniInboundMessage,
    adapter?: ChannelAdapter,
  ): Promise<ExternalConversationRow> {
    // --- Thread resolution (email) — only when the message references other
    // --- messages. Anything else falls through to per-contact grouping.
    let referencedUnknownThread = false;
    if (message && adapter?.getThreadHints) {
      try {
        const hints = await adapter.getThreadHints(message);
        if (hints && hints.inReplyToMessageIds.length > 0) {
          // Indexed lookup over BOTH directions first (email_messages), then
          // the legacy JSON scan for rows written before migration 031.
          const threadConversationId = channel === 'email' && this.emailMessages
            ? await this.emailMessages.findConversationIdByRfcMessageIds(hints.inReplyToMessageIds)
            : null;
          const threaded = (threadConversationId
            ? await this.externalRepository.findByConversationId(threadConversationId)
            : null)
            ?? await this.externalRepository.findConversationByThreadMessageIds(
              channel,
              hints.inReplyToMessageIds,
            );
          if (threaded) {
            if (threaded.status === 'closed') {
              await this.externalRepository.updateConversationStatus(threaded.conversation_id, 'open');
              await this.externalRepository.clearDeliveryFailureOnReopen(threaded.conversation_id);
              return {
                ...threaded,
                status: 'open',
                delivery_fail_count: 0,
                last_delivery_error: null,
                last_delivery_failure_at: null,
              };
            }
            return threaded;
          }
          // Referenced Message-IDs exist but no conversation holds them — the
          // customer started a brand-new thread (or the parent predates this
          // system). Create a fresh conversation for it instead of gluing the
          // reply onto an unrelated thread of the same contact.
          referencedUnknownThread = true;
        }
      } catch (error) {
        // Thread hints are best-effort: a broken adapter must not block the
        // message; per-contact grouping remains the safety net.
        console.warn(
          `[omni:${channel}] Thread resolution failed — falling back to per-contact grouping:`,
          (error as Error).message,
        );
      }
    }

    // Header-less messages (no RFC 5322 threading headers — e.g. a first
    // email or a provider that strips In-Reply-To/References) resolve their
    // thread by subject: an email with a brand-new subject starts a NEW
    // conversation (so unrelated topics never share a thread), while a
    // repeated subject rejoins the customer's matching OPEN thread. A message
    // that referenced an unknown thread skips this and starts its own.
    const threadSubject = extractEmailSubject(message);
    if (!referencedUnknownThread && threadSubject && channel === 'email') {
      try {
        const bySubject = await this.externalRepository.findOpenConversationByContactAndName(
          channel,
          contact.id,
          threadSubject,
        );
        if (bySubject) {
          return bySubject;
        }
        // Fresh subject and no threading headers — start a new thread.
        referencedUnknownThread = true;
      } catch (error) {
        console.warn(
          `[omni:${channel}] Subject-based thread resolution failed — falling back to per-contact grouping:`,
          (error as Error).message,
        );
      }
    }

    // Fallback: reuse the contact's most recent conversation when there is no
    // subject signal at all (non-email channels, or an email whose subject the
    // provider dropped entirely).
    const existing = referencedUnknownThread
      ? null
      : await this.externalRepository.findConversationByContact(channel, contact.id);
    if (existing) {
      if (existing.status === 'closed') {
        await this.externalRepository.updateConversationStatus(existing.conversation_id, 'open');
        // New inbound activity proves the customer's chat is reachable again —
        // reset any recorded delivery failures alongside the reopen.
        await this.externalRepository.clearDeliveryFailureOnReopen(existing.conversation_id);
        return { ...existing, status: 'open', delivery_fail_count: 0, last_delivery_error: null, last_delivery_failure_at: null };
      }
      return existing;
    }

    // A thread-starting email names its conversation after the subject so
    // agents can tell apart the customer's open threads at a glance; the
    // generic per-contact name stays the fallback for header-less channels.
    const name = threadSubject
      ? `${threadSubject}`
      : `${contactName(contact)} (${channelLabel(channel)})`;
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
    // Email may carry several files in one delivery. Keep `media` as the
    // legacy primary attachment for channels that only expose one, but store
    // every item supplied by a multi-attachment adapter.
    const mediaItems = message.attachments?.length
      ? message.attachments
      : message.media
        ? [message.media]
        : [];
    const storedAttachments = await Promise.all(
      mediaItems.map(async (media) => ({
        media,
        stored: await this.downloadAndStoreMedia(channel, adapter, media),
      })),
    );

    let messageId: number;
    try {
      messageId = await this.messageRepository.create({
        conversation_id: conversationId,
        sender_id: contact.user_id,
        content,
        type: mediaItems[0]?.kind ?? 'text',
        reply_to: null,
      });
    } catch (error) {
      // Race between two webhook deliveries — treat as already-processed.
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        return null;
      }
      throw error;
    }

    for (const { media, stored } of storedAttachments) {
      if (!stored) continue;
      await this.messageRepository.createAttachment({
        message_id: messageId,
        file_name: stored.fileName,
        file_url: stored.fileUrl,
        file_type: media.mimeType,
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

    if (channel === 'email') {
      await this.recordInboundEmail(messageId, conversationId, message);
    }

    const persisted = (await this.messageRepository.findByIdWithSender(messageId)) as OutgoingMessage;
    persisted.reactions = [];
    persisted.attachments = storedAttachments.some(({ stored }) => !!stored)
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
    const mediaItems = message.attachments?.length
      ? message.attachments
      : message.media
        ? [message.media]
        : [];
    if (mediaItems.length === 0) return base;
    return {
      ...base,
      media: { kind: mediaItems[0].kind, file_ref: mediaItems[0].fileRef },
      attachments: mediaItems.map((media) => ({
        kind: media.kind,
        file_name: media.fileName,
        file_ref: media.fileRef,
      })),
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

      const uploadDir = resolveUploadDir();
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

  /**
   * Fan the inbound message out to the inbox agents. A customer email gets
   * its own event name, `email.message.received` (carrying the subject and
   * sender for the inbox preview); every other channel keeps the generic
   * `receive_message`. Exactly one event is sent per message — the client
   * routes both names into the same store update.
   */
  private async broadcastInboundMessage(
    channel: string,
    conversationId: number,
    message: OutgoingMessage,
    inbound?: OmniInboundMessage,
  ): Promise<void> {
    if (channel === 'email') {
      const email = ((inbound?.metadata as { email?: Record<string, unknown> } | null) || {}).email || {};
      await this.broadcastToConversation(conversationId, {
        type: EMAIL_MESSAGE_RECEIVED,
        channel,
        conversationId,
        message: serializeMessage(message),
        email: {
          subject: typeof email.subject === 'string' ? email.subject : null,
          from: bareAddress(email.from),
        },
      });
    } else {
      await this.broadcastToConversation(conversationId, {
        type: 'receive_message',
        message: serializeMessage(message),
        channel,
      });
    }
    this.notifyMembers(message, conversationId, message.notifiedUserIds || []);
  }

  // ---------------------------------------------------------------------------
  // Outbound agent reply
  // ---------------------------------------------------------------------------

  /** Start a new outbound email thread addressed to a customer. */
  async startEmailConversation(
    agentId: number,
    to: string,
    subject: string,
    text: string,
  ): Promise<{ conversationId: number; message: OutgoingMessage }> {
    const recipient = to.trim().toLowerCase();
    const emailHealth = await this.requireAdapter('email').getHealth();
    if (!emailHealth.connected) {
      throw badRequest('Email delivery is not configured. Set up the server email provider before sending.');
    }
    const contact = await this.findOrCreateContact('email', {
      externalContactId: recipient,
      username: recipient,
      firstName: 'Email',
      lastName: 'Customer',
      externalMessageId: `outbound-${crypto.randomUUID()}`,
      content: text,
      metadata: { email: { address: recipient } },
    });

    const conversationId = await this.conversationRepository.create({
      type: 'direct',
      created_by: agentId,
      name: subject.trim(),
      description: `Email conversation with ${recipient}`,
    });
    await this.conversationRepository.addMember(conversationId, contact.user_id, 'member');
    await this.conversationRepository.addMember(conversationId, agentId, 'member');
    await this.joinInboxAgents(conversationId);
    await this.externalRepository.createConversation({
      conversation_id: conversationId,
      contact_id: contact.id,
      channel: 'email',
      status: 'open',
      assigned_agent_id: agentId,
    });

    // The normal outbound path delivers through the configured email adapter,
    // records delivery status and keeps the new conversation replyable.
    const message = await this.sendAgentReply(conversationId, agentId, text);
    return { conversationId, message };
  }

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
    if (trimmed.length > MAX_REPLY_LENGTH) {
      throw badRequest(`Message is too long (max ${MAX_REPLY_LENGTH} characters)`);
    }

    const resolved = await this.resolveExternalConversation(conversationId, agentId, replyToMessageId);

    if (resolved.channel === 'email' && this.emailMessages) {
      return this.sendEmailWithStatus(resolved, agentId, {
        content: trimmed,
        createMessage: () => this.messageRepository.create({
          conversation_id: conversationId,
          sender_id: agentId,
          content: trimmed,
          type: 'text',
          reply_to: null,
        }),
        ledgerMetadata: null,
        send: (threading) => resolved.adapter.sendMessage(resolved.chatId, trimmed, {
          replyToExternalMessageId: resolved.replyToExternalMessageId,
          threading,
        }),
      });
    }

    // Deliver through the channel first — only persist on success. Email
    // replies additionally receive RFC 5322 threading headers derived from
    // the customer's last email so mail clients group the thread correctly;
    // other channels ignore the field (and it is omitted entirely).
    const threading = await this.resolveEmailThreading(resolved);
    const sent = await resolved.adapter.sendMessage(resolved.chatId, trimmed, {
      replyToExternalMessageId: resolved.replyToExternalMessageId,
      ...(threading ? { threading } : {}),
    });
    if (!sent.ok) {
      await this.reportDeliveryFailure(resolved, sent.description ?? 'Channel delivery failed', sent.errorCode);
    }

    // Delivery succeeded — reset any previously recorded failure state.
    await this.externalRepository.clearDeliveryFailure(conversationId);

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
      channel: resolved.channel,
      direction: 'outbound',
      sender_type: 'agent',
      content: trimmed,
      external_timestamp: new Date(),
      metadata: sent.externalMessageId
        ? { [resolved.channel]: { message_id: sent.externalMessageId } }
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
      { type: 'receive_message', message: serializeMessage(message), channel: resolved.channel },
      { excludeUserId: agentId },
    );
    this.notifyMembers(message, conversationId, message.notifiedUserIds || []);

    return message;
  }

  /**
   * Send an agent file / voice note to the external customer through the
   * conversation's channel adapter. The bytes are uploaded from the agent's
   * request (already validated by the multer filter) and delivered to the
   * channel FIRST — the message + attachment are persisted only when the
   * provider confirms delivery, mirroring sendAgentReply.
   */
  async sendAgentMediaReply(
    conversationId: number,
    agentId: number,
    media: OmniOutboundMedia,
    replyToMessageId?: number | null,
  ): Promise<OutgoingMessage> {
    if (!media.buffer || media.buffer.length === 0) {
      throw badRequest('A non-empty file is required');
    }

    const resolved = await this.resolveExternalConversation(conversationId, agentId, replyToMessageId);
    const adapter = resolved.adapter;
    if (!adapter.sendMedia) {
      throw badRequest(`Channel ${resolved.channel} does not support media delivery`);
    }

    if (resolved.channel === 'email' && this.emailMessages) {
      // The local copy is written up front because the message row now exists
      // before delivery (status 'pending') and must already show its file.
      const stored = this.storeOutboundMediaBuffer(media);
      const fileUrl = stored?.fileUrl || '';
      const displayName = (media.caption || '').trim() || media.fileName;
      return this.sendEmailWithStatus(resolved, agentId, {
        content: displayName,
        createMessage: async () => {
          const id = await this.messageRepository.create({
            conversation_id: conversationId,
            sender_id: agentId,
            content: displayName,
            type: media.kind === 'voice' ? 'voice' : media.kind === 'image' ? 'image' : 'file',
            reply_to: replyToMessageId || null,
          });
          await this.messageRepository.createAttachment({
            message_id: id,
            file_name: media.fileName,
            file_url: fileUrl,
            file_type: media.mimeType,
            file_size: media.buffer.length,
          });
          return id;
        },
        ledgerMetadata: {
          media: { kind: media.kind, file_name: media.fileName, ...(fileUrl ? { file_url: fileUrl } : {}) },
        },
        send: (threading) => adapter.sendMedia!(resolved.chatId, media, {
          replyToExternalMessageId: resolved.replyToExternalMessageId,
          threading,
        }),
      });
    }

    const threading = await this.resolveEmailThreading(resolved);
    const sent = await adapter.sendMedia(resolved.chatId, media, {
      replyToExternalMessageId: resolved.replyToExternalMessageId,
      ...(threading ? { threading } : {}),
    });
    if (!sent.ok) {
      await this.reportDeliveryFailure(
        resolved,
        sent.description ?? 'Channel media delivery failed',
        sent.errorCode,
      );
    }

    await this.externalRepository.clearDeliveryFailure(conversationId);

    // Keep the bytes locally so agents can replay the attachment in the chat
    // history even if the provider copy becomes unreachable.
    const stored = this.storeOutboundMediaBuffer(media);
    const fileUrl = stored?.fileUrl || '';

    const displayName = (media.caption || '').trim() || media.fileName;
    const messageId = await this.messageRepository.create({
      conversation_id: conversationId,
      sender_id: agentId,
      content: displayName,
      type: media.kind === 'voice' ? 'voice' : media.kind === 'image' ? 'image' : 'file',
      reply_to: replyToMessageId || null,
    });
    await this.messageRepository.createAttachment({
      message_id: messageId,
      file_name: media.fileName,
      file_url: fileUrl,
      file_type: media.mimeType,
      file_size: media.buffer.length,
    });
    await this.externalRepository.createMessage({
      message_id: messageId,
      conversation_id: conversationId,
      external_message_id: sent.externalMessageId || null,
      channel: resolved.channel,
      direction: 'outbound',
      sender_type: 'agent',
      content: displayName,
      external_timestamp: new Date(),
      metadata: {
        media: {
          kind: media.kind,
          file_name: media.fileName,
          ...(fileUrl ? { file_url: fileUrl } : {}),
          ...(sent.externalMessageId
            ? { [resolved.channel]: { message_id: sent.externalMessageId } }
            : {}),
        },
      },
    });

    const message = (await this.messageRepository.findByIdWithSender(messageId)) as OutgoingMessage;
    message.reactions = [];
    message.attachments = await this.messageRepository.findAttachments(messageId);
    message.notifiedUserIds = await this.messageService.createMessageNotifications(
      message,
      agentId,
      conversationId,
      displayName,
      [],
    );

    await this.broadcastToConversation(
      conversationId,
      { type: 'receive_message', message: serializeMessage(message), channel: resolved.channel },
      { excludeUserId: agentId },
    );
    this.notifyMembers(message, conversationId, message.notifiedUserIds || []);

    return message;
  }

  /**
   * Store an outbound media buffer under the shared uploads directory using
   * the same naming scheme as every other upload writer. Returns null when
   * the disk write fails — the message still records (delivery already
   * succeeded) minus the local replay copy.
   */
  private storeOutboundMediaBuffer(
    media: OmniOutboundMedia,
  ): { fileUrl: string; fileName: string; fileSize: number } | null {
    try {
      const uploadDir = resolveUploadDir();
      fs.mkdirSync(uploadDir, { recursive: true });
      const ext = path.extname(media.fileName).toLowerCase();
      const base = path
        .basename(media.fileName, ext)
        .replace(/[^a-zA-Z0-9-_]/g, '_')
        .slice(0, 60);
      const storedName = `${Date.now()}-${Math.round(Math.random() * 1e6)}-${base}${ext}`;
      fs.writeFileSync(path.join(uploadDir, storedName), media.buffer);
      return { fileUrl: `/uploads/${storedName}`, fileName: media.fileName, fileSize: media.buffer.length };
    } catch (error) {
      console.error('[omni] Could not store the outbound media copy:', (error as Error).message);
      return null;
    }
  }

  /**
   * Email outbound lifecycle (migration 031): record → send → finalize.
   *
   *   1. Generate the Message-ID and store the message as 'pending' BEFORE
   *      sending — a crash mid-send leaves a visible pending row, not a gap.
   *   2. Send through SMTP with that exact Message-ID + threading headers.
   *   3. Mark 'sent' only after the SMTP server accepted it. Otherwise mark
   *      'failed' with the sanitized reason, show the failed bubble to every
   *      inbox member (the agent's REST call answers 502), flag the
   *      conversation, and throw.
   */
  private async sendEmailWithStatus(
    resolved: { conversationId: number; channel: string; chatId: string | number; deliveryFailCount: number },
    agentId: number,
    outbound: {
      content: string;
      createMessage: () => Promise<number>;
      ledgerMetadata: Record<string, unknown> | null;
      send: (threading: OmniOutboundThreading) => Promise<OmniOutboundResult>;
    },
  ): Promise<OutgoingMessage> {
    const emailMessages = this.emailMessages as EmailMessageRepository;
    const { conversationId, channel } = resolved;

    // Which previous email + which Message-IDs: the thread parent's id becomes
    // In-Reply-To, and References = parent's References + parent's own id.
    const parent = await this.resolveEmailThreading(resolved);
    const rfcMessageId = generateMessageId();
    const threading: OmniOutboundThreading = { ...(parent || {}), messageId: rfcMessageId };
    const inReplyTo = normalizeMessageId(threading.inReplyTo);
    const references = normalizeReferences([...(threading.references || []), ...(inReplyTo ? [inReplyTo] : [])]);

    const messageId = await outbound.createMessage();
    await this.externalRepository.createMessage({
      message_id: messageId,
      conversation_id: conversationId,
      external_message_id: `<${rfcMessageId}>`,
      channel,
      direction: 'outbound',
      sender_type: 'agent',
      content: outbound.content,
      external_timestamp: new Date(),
      metadata: { ...(outbound.ledgerMetadata || {}), email: { message_id: `<${rfcMessageId}>` } },
    });
    await emailMessages.create({
      message_id: messageId,
      conversation_id: conversationId,
      direction: 'outbound',
      rfc_message_id: rfcMessageId,
      in_reply_to: inReplyTo,
      references_ids: references,
      subject: threading.inReplyTo || threading.references
        ? buildReplySubject(threading.subject)
        : threading.subject || null,
      from_address: getFromAddress().address.toLowerCase(),
      to_address: String(resolved.chatId).toLowerCase(),
      delivery_status: 'pending',
    });

    let sent: OmniOutboundResult;
    try {
      sent = await outbound.send(threading);
    } catch (error) {
      console.error(`[omni:${channel}] Adapter threw while sending message ${messageId}:`, (error as Error).message);
      sent = { ok: false, description: 'Email delivery failed' };
    }

    if (!sent.ok) {
      const reason = sent.description || 'Email delivery failed';
      await emailMessages.markFailed(messageId, reason);
      const failed = await this.loadOutgoingMessage(messageId);
      await this.broadcastToConversation(conversationId, {
        type: 'receive_message',
        message: serializeMessage(failed),
        channel,
      });
      await this.reportDeliveryFailure(resolved, reason, sent.errorCode);
    }

    await emailMessages.markSent(messageId);
    await this.externalRepository.clearDeliveryFailure(conversationId);

    const message = await this.loadOutgoingMessage(messageId);
    message.notifiedUserIds = await this.messageService.createMessageNotifications(
      message,
      agentId,
      conversationId,
      outbound.content,
      [],
    );
    await this.broadcastToConversation(
      conversationId,
      { type: 'receive_message', message: serializeMessage(message), channel },
      { excludeUserId: agentId },
    );
    this.notifyMembers(message, conversationId, message.notifiedUserIds || []);
    return message;
  }

  /** A stored message with sender, attachments and delivery status, ready to serialize. */
  private async loadOutgoingMessage(messageId: number): Promise<OutgoingMessage> {
    const message = (await this.messageRepository.findByIdWithSender(messageId)) as OutgoingMessage;
    message.reactions = [];
    message.attachments = await this.messageRepository.findAttachments(messageId);
    return message;
  }

  /**
   * Store an inbound email's threading headers (migration 031). Best-effort:
   * the message itself is already saved, so a bookkeeping failure is logged
   * and never drops what the customer sent.
   */
  private async recordInboundEmail(
    messageId: number,
    conversationId: number,
    message: OmniInboundMessage,
  ): Promise<void> {
    if (!this.emailMessages) return;
    const email = ((message.metadata as { email?: Record<string, unknown> } | null) || {}).email || {};
    try {
      await this.emailMessages.create({
        message_id: messageId,
        conversation_id: conversationId,
        direction: 'inbound',
        rfc_message_id: normalizeMessageId(email.messageId as string | undefined),
        in_reply_to: normalizeMessageId(email.inReplyTo as string | undefined),
        references_ids: normalizeReferences(email.references),
        subject: typeof email.subject === 'string' ? email.subject.slice(0, 998) : null,
        from_address: bareAddress(email.from),
        to_address: bareAddress(email.to),
      });
    } catch (error) {
      console.error(`[omni:email] Could not record threading headers for message ${messageId}:`, (error as Error).message);
    }
  }

  /**
   * Email threading (RFC 5322) for the reply path: derive subject +
   * Message-ID chain from the customer's most recent inbound email stored in
   * the external ledger. Returns null for every other channel (or when the
   * conversation has no inbound email yet, e.g. an agent-initiated thread).
   */
  private async resolveEmailThreading(resolved: {
    channel: string;
    conversationId: number;
  }): Promise<{ subject?: string | null; inReplyTo?: string | null; references?: string[] | null } | null> {
    if (resolved.channel !== 'email') return null;
    if (this.emailMessages) {
      const parent = await this.emailMessages.findReplyParent(resolved.conversationId);
      if (parent) {
        return {
          subject: parent.subject,
          inReplyTo: parent.rfc_message_id,
          references: parent.references_ids ? parent.references_ids.split(' ') : null,
        };
      }
    }
    const latest = await this.externalRepository.findLatestInboundMessage(
      resolved.conversationId,
      resolved.channel,
    );
    if (!latest) {
      const conversation = await this.conversationRepository.findById(resolved.conversationId);
      return conversation?.name ? { subject: conversation.name } : null;
    }
    const metadata = (latest.metadata as { email?: { subject?: string; messageId?: string; references?: string | string[] } } | null) || {};
    const emailMeta = metadata.email || {};
    return {
      subject: emailMeta.subject || null,
      inReplyTo: emailMeta.messageId || null,
      references: Array.isArray(emailMeta.references)
        ? emailMeta.references
        : emailMeta.references
          ? String(emailMeta.references).split(/\s+/).filter(Boolean)
          : null,
    };
  }

  /**
   * Shared outbound resolution: verify the conversation is external, the
   * agent a member, resolve the provider chat id + adapter, and map an
   * internal reply-to id onto the provider's message id.
   */
  private async resolveExternalConversation(
    conversationId: number,
    agentId: number,
    replyToMessageId?: number | null,
  ): Promise<{
    conversationId: number;
    channel: string;
    adapter: ChannelAdapter;
     chatId: string | number;
    replyToExternalMessageId: string | null;
    deliveryFailCount: number;
  }> {
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
    const rawChatId = String(external.external_contact_id);
    const chatId: string | number = external.channel === 'email'
      ? rawChatId
      : Number(rawChatId);
    if (external.channel !== 'email' && (!Number.isFinite(chatId as number) || (chatId as number) <= 0)) {
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

    return {
      conversationId,
      channel: external.channel,
      adapter,
      chatId,
      replyToExternalMessageId,
      deliveryFailCount: Number(external.delivery_fail_count ?? 0),
    };
  }

  /**
   * Record + fan out a failed channel delivery (migration 028 delivery
   * health) and raise the 502 the controller surfaces to the agent.
   */
  private async reportDeliveryFailure(
    resolved: {
      conversationId: number;
      channel: string;
      deliveryFailCount: number;
    },
    description: string,
    errorCode?: number,
  ): Promise<never> {
    // Surface the provider's own reason in the server log (the HTTP error
    // body carries `description` to the agent; the code helps diagnosis —
    // e.g. 400 chat not found, 403 bot blocked).
    console.error(
      `[omni:${resolved.channel}] Delivery failed for conversation ${resolved.conversationId} (${description}${errorCode ? `, code ${errorCode}` : ''})`,
    );
    // Record the failure so the inbox can flag conversations whose channel
    // delivery keeps failing.
    await this.externalRepository.recordDeliveryFailure(resolved.conversationId, description);
    const deliveryFailCount = resolved.deliveryFailCount + 1;
    await this.broadcastToConversation(resolved.conversationId, {
      type: 'omni_delivery_failed',
      data: {
        conversationId: resolved.conversationId,
        channel: resolved.channel,
        deliveryFailCount,
        lastDeliveryError: description.slice(0, 255),
      },
    });
    throw deliveryError(description);
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

  /**
   * Per-channel client capabilities, derived from what each adapter actually
   * implements. `media` mirrors the optional `sendMedia` contract — the
   * composer hides its file/voice entry points for channels that cannot relay
   * attachments (e.g. the website widget) instead of letting agents hit a 400.
   */
  getCapabilities(): Record<string, { media: boolean }> {
    const capabilities: Record<string, { media: boolean }> = {};
    for (const channel of this.registry.channels()) {
      capabilities[channel] = { media: !!this.registry.get(channel)?.sendMedia };
    }
    return capabilities;
  }

  private requireAdapter(channel: string): ChannelAdapter {
    const adapter = this.registry.get(channel);
    if (!adapter) {
      throw badRequest(`Unknown channel: ${channel}`);
    }
    return adapter;
  }
}
