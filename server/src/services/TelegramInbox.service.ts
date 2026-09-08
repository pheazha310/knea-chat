/**
 * TelegramInboxService — application layer for the Telegram omni-channel.
 *
 * Orchestrates the inbound webhook flow and the outbound agent-reply flow on
 * top of the existing KneaChat stack:
 *
 *   Telegram → webhook → contact → conversation → message → MySQL → WebSocket
 *   Agent → POST /api/telegram/messages → TelegramService → Telegram customer
 *
 * Telegram API calls stay in TelegramService; database access goes through
 * repositories; WebSocket fan-out reuses the existing broadcast utilities.
 * External identities (Telegram user/message ids) are stored in the
 * external_* tables and are never treated as internal user ids.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import type { ExternalContactRow, ExternalConversationRow, OutgoingMessage } from '../types';
import type {
  TelegramMessage,
  TelegramUpdate,
  TelegramUser,
} from '../integrations/telegram/telegram.types';
import type { TelegramService } from '../integrations/telegram/telegram.service';
import { TelegramApiError } from '../integrations/telegram/telegram.service';
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

const CHANNEL = 'telegram';

/** Contact display name used as the internal conversation name. */
const contactName = (contact: {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}): string => {
  const full = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  return full || contact.username || 'Telegram Customer';
};

/** Convert a Telegram unix-seconds timestamp to a JS Date (for MySQL DATETIME). */
const telegramDate = (unixSeconds: number): Date => new Date(unixSeconds * 1000);

/** Media attachment extracted from a Telegram message (text + media supported). */
interface MediaAttachment {
  kind: 'image' | 'voice' | 'file';
  fileId: string;
  fileName: string;
  mimeType: string | null;
}

/** Pick the media attachment from a message, or null when it is text-only. */
const extractMedia = (message: TelegramMessage): MediaAttachment | null => {
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo.reduce((a, b) =>
      b.width * b.height > a.width * a.height ? b : a,
    );
    return {
      kind: 'image',
      fileId: largest.file_id,
      fileName: `photo_${message.message_id}.jpg`,
      mimeType: 'image/jpeg',
    };
  }
  if (message.voice) {
    return {
      kind: 'voice',
      fileId: message.voice.file_id,
      fileName: `voice_${message.message_id}.ogg`,
      mimeType: message.voice.mime_type || 'audio/ogg',
    };
  }
  if (message.document) {
    return {
      kind: 'file',
      fileId: message.document.file_id,
      fileName: message.document.file_name || `document_${message.message_id}`,
      mimeType: message.document.mime_type || null,
    };
  }
  if (message.video) {
    return {
      kind: 'file',
      fileId: message.video.file_id,
      fileName: message.video.file_name || `video_${message.message_id}.mp4`,
      mimeType: message.video.mime_type || 'video/mp4',
    };
  }
  if (message.audio) {
    return {
      kind: 'file',
      fileId: message.audio.file_id,
      fileName: message.audio.file_name || `audio_${message.message_id}`,
      mimeType: message.audio.mime_type || null,
    };
  }
  if (message.animation) {
    return {
      kind: 'file',
      fileId: message.animation.file_id,
      fileName: message.animation.file_name || `animation_${message.message_id}.gif`,
      mimeType: message.animation.mime_type || 'image/gif',
    };
  }
  if (message.sticker) {
    return {
      kind: 'file',
      fileId: message.sticker.file_id,
      fileName: `sticker_${message.message_id}.webp`,
      mimeType: 'image/webp',
    };
  }
  return null;
};

const snippetOf = (text: string): string =>
  text.length > 120 ? `${text.slice(0, 120)}…` : text;

export class TelegramInboxService {
  constructor(
    private telegramApi: TelegramService,
    private externalRepository: ExternalContactRepository,
    private userRepository: UserRepository,
    private companyRepository: CompanyRepository,
    private conversationRepository: ConversationRepository,
    private messageRepository: MessageRepository,
    private messageService: MessageService,
    private broadcastToConversation: BroadcastToConversation,
  ) {}

  // ---------------------------------------------------------------------------
  // Inbound webhook
  // ---------------------------------------------------------------------------

  /**
   * Process a Telegram update delivered to the webhook. Returns the persisted
   * message, or null when the update was ignored (unsupported type) or was a
   * duplicate redelivery. Never throws for ignorable updates.
   */
  async handleWebhookUpdate(
    update: TelegramUpdate,
  ): Promise<OutgoingMessage | null> {
    const message = update.message;
    if (!message) {
      // edited_message / channel_post / callback_query / … are unsupported —
      // acknowledge silently so Telegram does not retry them forever.
      return null;
    }

    if (!message.from) {
      // Malformed / unsupported — acknowledge so Telegram does not retry.
      console.warn(`[telegram] Ignoring update ${update.update_id}: missing sender`);
      return null;
    }
    if (!message.chat || !message.chat.id) {
      console.warn(`[telegram] Ignoring update ${update.update_id}: missing chat`);
      return null;
    }

    const media = extractMedia(message);
    const text = message.text || '';
    if (!media && !text) {
      // Non-text, non-media message kinds (polls, locations, …) are ignored.
      console.log(`[telegram] Ignoring unsupported message ${message.message_id}`);
      return null;
    }

    const contact = await this.findOrCreateContact(message.from);
    const externalConversation = await this.findOrCreateConversation(contact);

    const persisted = media
      ? await this.createInboundMediaMessage(
          externalConversation.conversation_id,
          contact,
          message,
          media,
        )
      : await this.createInboundMessage(
          externalConversation.conversation_id,
          contact,
          message,
        );

    if (persisted) {
      await this.broadcastInboundMessage(externalConversation.conversation_id, persisted);
    }
    return persisted;
  }

  /**
   * Find the external contact for a Telegram user; create the shadow user +
   * contact row on first sight. The Telegram user id is stored in
   * external_contacts.external_contact_id, never as an internal user id.
   */
  async findOrCreateContact(user: TelegramUser): Promise<ExternalContactRow> {
    const externalId = String(user.id);
    const existing = await this.externalRepository.findByChannelAndExternalId(
      CHANNEL,
      externalId,
    );
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
      email: `telegram.${externalId}@external.kneachat.local`,
      password,
      first_name: user.first_name || 'Telegram',
      last_name: user.last_name || 'User',
      role: 'external',
    });

    const contactId = await this.externalRepository.createContact({
      user_id: userId,
      channel: CHANNEL,
      external_contact_id: externalId,
      username: user.username || null,
      first_name: user.first_name || null,
      last_name: user.last_name || null,
      metadata: { is_bot: user.is_bot },
    });

    return {
      id: contactId,
      user_id: userId,
      channel: CHANNEL,
      external_contact_id: externalId,
      username: user.username || null,
      first_name: user.first_name || null,
      last_name: user.last_name || null,
      metadata: { is_bot: user.is_bot },
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  /**
   * Find the customer's Telegram conversation; create it on first contact.
   * One conversation per contact+channel is reused for every subsequent
   * message (never one conversation per message). Internal users are joined so
   * the conversation shows up in the Unified Inbox.
   */
  async findOrCreateConversation(
    contact: ExternalContactRow,
  ): Promise<ExternalConversationRow> {
    const existing = await this.externalRepository.findConversationByContact(
      CHANNEL,
      contact.id,
    );
    if (existing) {
      if (existing.status === 'closed') {
        await this.externalRepository.updateConversationStatus(existing.conversation_id, 'open');
        return { ...existing, status: 'open' };
      }
      return existing;
    }

    const name = `${contactName(contact)} (Telegram)`;
    const conversationId = await this.conversationRepository.create({
      type: 'direct',
      created_by: contact.user_id,
      name,
      description: 'Telegram conversation',
    });

    await this.conversationRepository.addMember(conversationId, contact.user_id, 'member');
    await this.joinInboxAgents(conversationId);

    const externalConversationId = await this.externalRepository.createConversation({
      conversation_id: conversationId,
      contact_id: contact.id,
      channel: CHANNEL,
      status: 'open',
    });

    return {
      id: externalConversationId,
      conversation_id: conversationId,
      contact_id: contact.id,
      channel: CHANNEL,
      status: 'open',
      assigned_agent_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  /**
   * Join the agents who should see omni-channel inbox conversations. Defaults
   * to every internal user (role != 'external'); an explicit
   * TELEGRAM_INBOX_AGENT_IDS override restricts the inbox to those users.
   */
  private async joinInboxAgents(conversationId: number): Promise<void> {
    const override = (process.env.TELEGRAM_INBOX_AGENT_IDS || '')
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
          `[telegram] Could not join agent ${agentId} to conversation ${conversationId}:`,
          (error as Error).message,
        );
      }
    }
  }

  /**
   * Persist an inbound Telegram message (internal `messages` row + external
   * ledger). Duplicate redeliveries are detected by the unique
   * (channel, external_message_id) key and skipped.
   */
  async createInboundMessage(
    conversationId: number,
    contact: ExternalContactRow,
    message: TelegramMessage,
  ): Promise<OutgoingMessage | null> {
    const externalMessageId = String(message.message_id);
    const duplicate = await this.externalRepository.findMessageByExternalId(
      CHANNEL,
      externalMessageId,
    );
    if (duplicate) {
      console.log(`[telegram] Duplicate inbound message ${externalMessageId} ignored`);
      return null;
    }

    const content = message.text || '';
    let messageId: number;
    try {
      messageId = await this.messageRepository.create({
        conversation_id: conversationId,
        sender_id: contact.user_id,
        content,
        type: 'text',
        reply_to: null,
      });
    } catch (error) {
      // Race between two webhook deliveries — treat as already-processed.
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        return null;
      }
      throw error;
    }

    try {
      await this.externalRepository.createMessage({
        message_id: messageId,
        conversation_id: conversationId,
        external_message_id: externalMessageId,
        channel: CHANNEL,
        direction: 'inbound',
        sender_type: 'customer',
        content,
        external_timestamp: telegramDate(message.date),
        metadata: { telegram: { message_id: message.message_id, date: message.date } },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        console.log(`[telegram] Duplicate inbound message ${externalMessageId} ignored (race)`);
        return null;
      }
      throw error;
    }

    const persisted = (await this.messageRepository.findByIdWithSender(messageId)) as OutgoingMessage;
    persisted.reactions = [];
    persisted.attachments = [];

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

  /**
   * Persist an inbound Telegram media message (photo / voice / document / …):
   * downloads the file from Telegram's file server, stores it under the
   * shared uploads directory, and records a `file`/`image`/`voice` message
   * with an attachment. Duplicate redeliveries are skipped.
   */
  private async createInboundMediaMessage(
    conversationId: number,
    contact: ExternalContactRow,
    message: TelegramMessage,
    media: MediaAttachment,
  ): Promise<OutgoingMessage | null> {
    const externalMessageId = String(message.message_id);
    const duplicate = await this.externalRepository.findMessageByExternalId(
      CHANNEL,
      externalMessageId,
    );
    if (duplicate) {
      console.log(`[telegram] Duplicate media message ${externalMessageId} ignored`);
      return null;
    }

    const content = (message.caption || message.text || media.fileName).trim();
    const stored = await this.downloadAndStoreMedia(media);

    let messageId: number;
    try {
      messageId = await this.messageRepository.create({
        conversation_id: conversationId,
        sender_id: contact.user_id,
        content,
        type: media.kind,
        reply_to: null,
      });
    } catch (error) {
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
        file_type: media.mimeType,
        file_size: stored.fileSize,
      });
    }

    try {
      await this.externalRepository.createMessage({
        message_id: messageId,
        conversation_id: conversationId,
        external_message_id: externalMessageId,
        channel: CHANNEL,
        direction: 'inbound',
        sender_type: 'customer',
        content,
        external_timestamp: telegramDate(message.date),
        metadata: {
          telegram: {
            message_id: message.message_id,
            date: message.date,
            media: { kind: media.kind, file_id: media.fileId },
          },
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        console.log(`[telegram] Duplicate media message ${externalMessageId} ignored (race)`);
        return null;
      }
      throw error;
    }

    const persisted = (await this.messageRepository.findByIdWithSender(messageId)) as OutgoingMessage;
    persisted.reactions = [];
    persisted.attachments = await this.messageRepository.findAttachments(messageId);
    persisted.notifiedUserIds = await this.messageService.createMessageNotifications(
      persisted,
      contact.user_id,
      conversationId,
      content,
      [],
    );
    return persisted;
  }

  /**
   * Download a Telegram media file and store it under the shared uploads
   * directory. Returns null when Telegram cannot resolve/download the file
   * (the message is still recorded so agents see it, just without the file).
   */
  private async downloadAndStoreMedia(
    media: MediaAttachment,
  ): Promise<{ fileUrl: string; fileName: string; fileSize: number | null } | null> {
    try {
      const fileInfo = await this.telegramApi.getFile(media.fileId);
      if (!fileInfo.ok || !fileInfo.result?.file_path) {
        console.warn(
          `[telegram] Could not resolve file ${media.fileId}: ${fileInfo.description || 'unknown error'}`,
        );
        return null;
      }
      const buffer = await this.telegramApi.downloadFile(fileInfo.result.file_path);

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

      return {
        fileUrl: `/uploads/${storedName}`,
        fileName: media.fileName,
        fileSize: buffer.length,
      };
    } catch (error) {
      console.error('[telegram] Media download failed:', (error as Error).message);
      return null;
    }
  }

  /** Fan the inbound message out to the inbox agents (existing WS conventions). */
  private async broadcastInboundMessage(
    conversationId: number,
    message: OutgoingMessage,
  ): Promise<void> {
    const serialized = serializeMessage(message);
    await this.broadcastToConversation(conversationId, {
      type: 'receive_message',
      message: serialized,
      channel: CHANNEL,
    });
    this.notifyMembers(message, conversationId, message.notifiedUserIds || []);
  }

  // ---------------------------------------------------------------------------
  // Outbound agent reply
  // ---------------------------------------------------------------------------

  /**
   * Send an agent reply to the Telegram customer.
   *
   * The Telegram chat id is resolved server-side from the stored external
   * contact — the client only supplies the conversation id, never a chat id.
   * The message is persisted only after Telegram confirms delivery.
   */
  async sendAgentReply(
    agentId: number,
    conversationId: number,
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
      throw badRequest('This conversation is not a Telegram conversation');
    }

    const isMember = await this.conversationRepository.isMember(conversationId, agentId);
    if (!isMember) {
      throw badRequest('You are not a member of this conversation');
    }

    const chatId = Number(external.external_contact_id);
    if (!Number.isFinite(chatId) || chatId <= 0) {
      throw new Error('Telegram chat id for this conversation is invalid');
    }

    // Deliver to Telegram first — only persist on success. `replyToMessageId`
    // is an INTERNAL messages.id; Telegram needs its own message id, so map it
    // through the external ledger (silently ignored when unknown).
    const options: { reply_to_message_id?: number } = {};
    if (replyToMessageId) {
      const replyTarget = await this.messageRepository.findById(replyToMessageId);
      if (replyTarget && Number(replyTarget.conversation_id) === conversationId) {
        const replyExternal = await this.externalRepository.findByMessageId(replyToMessageId);
        const telegramId = Number(replyExternal?.external_message_id);
        if (Number.isFinite(telegramId) && telegramId > 0) {
          options.reply_to_message_id = telegramId;
        }
      }
    }
    const sent = await this.telegramApi.sendMessage(chatId, trimmed, options);
    if (!sent.ok) {
      throw new TelegramApiError(
        `Telegram API error: ${sent.description || 'failed to send message'}`,
        sent.error_code,
      );
    }
    const externalMessageId = sent.result?.message_id
      ? String(sent.result.message_id)
      : null;

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
      external_message_id: externalMessageId,
      channel: CHANNEL,
      direction: 'outbound',
      sender_type: 'agent',
      content: trimmed,
      external_timestamp: new Date(),
      metadata: externalMessageId
        ? { telegram: { message_id: Number(externalMessageId) } }
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
      { type: 'receive_message', message: serializeMessage(message), channel: CHANNEL },
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
  // Agent assignment
  // ---------------------------------------------------------------------------

  /**
   * Assign (or unassign, agentId = null) an agent to a Telegram conversation.
   * The requester must be a member; the assignee must be a member too (an
   * outsider can never be pinned to an inbox conversation).
   */
  async assignAgent(
    conversationId: number,
    requesterId: number,
    agentId: number | null,
  ): Promise<{ conversationId: number; assignedAgentId: number | null }> {
    const external = await this.externalRepository.findByConversationId(conversationId);
    if (!external) {
      throw badRequest('This conversation is not a Telegram conversation');
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
      type: 'telegram_assignment_changed',
      data: { conversationId, assignedAgentId: agentId },
    });

    return { conversationId, assignedAgentId: agentId };
  }

  // ---------------------------------------------------------------------------
  // Health + webhook administration (delegated to TelegramService)
  // ---------------------------------------------------------------------------

  /** True when a conversation is backed by the Telegram channel. */
  async isTelegramConversation(conversationId: number): Promise<boolean> {
    return !!(await this.externalRepository.findByConversationId(conversationId));
  }

  /** Health check — configuration present + bot token verifies against the API. */
  async getHealth(): Promise<{ connected: boolean; bot?: { id: number; username: string } }> {
    if (!this.telegramApi.isConfigured()) {
      return { connected: false };
    }
    const result = await this.telegramApi.getMe();
    if (result.ok && result.result) {
      return {
        connected: true,
        bot: { id: result.result.id, username: result.result.username },
      };
    }
    return { connected: false };
  }

  async setupWebhook(webhookUrl: string): Promise<unknown> {
    return this.telegramApi.setWebhook(webhookUrl);
  }

  async getWebhookInfo(): Promise<unknown> {
    return this.telegramApi.getWebhookInfo();
  }

  async deleteWebhook(): Promise<unknown> {
    return this.telegramApi.deleteWebhook();
  }
}