/**
 * MessageService — business logic for messages (send, edit, delete, pin,
 * reactions, file uploads, mentions/notifications).
 */
import type { MessageRepository } from '../repositories/messageRepository';
import type { ReactionRepository } from '../repositories/reactionRepository';
import type { ConversationRepository } from '../repositories/conversationRepository';
import type { NotificationRepository } from '../repositories/notificationRepository';
import type { NotificationPreferenceService } from './NotificationPreference.service';
import { extractMentionedUserIds } from '../utils/mentions.utils';
import type {
  CreateFileMessageData,
  CreateMessageData,
  MessageSearchFilters,
  OutgoingMessage,
} from '../types';

export class MessageService {
  constructor(
    private messageRepository: MessageRepository,
    private reactionRepository: ReactionRepository,
    private conversationRepository: ConversationRepository,
    private notificationRepository: NotificationRepository,
    private notificationPreferences?: NotificationPreferenceService | null,
  ) {}

  /**
   * Authorization rule for message access. Team conversations are restricted
   * to team members + privileged roles (super_admin / admin / manager); every
   * other conversation type requires conversation membership.
   */
  private async assertConversationAccess(
    conversation: { id: number; type: string; name: string | null },
    userId: number,
  ): Promise<void> {
    if (conversation.type === 'team') {
      const ok = await this.conversationRepository.canAccessTeamConversation(
        conversation.name || '',
        userId,
      );
      if (!ok) {
        throw new Error('You must be a member of this team to access its conversation');
      }
      return;
    }
    const isMember = await this.conversationRepository.isMember(conversation.id, userId);
    if (!isMember) {
      throw new Error('You are not a member of this conversation');
    }
  }

  async getMessages(conversationId: number, page = 1, limit = 30, userId: number | null = null): Promise<OutgoingMessage[]> {
    if (userId) {
      const conversation = await this.conversationRepository.findById(conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      await this.assertConversationAccess(conversation, userId);
    }

    const messages = (await this.messageRepository.findAll({
      conversationId,
      page: parseInt(String(page)),
      limit: parseInt(String(limit)),
    })) as OutgoingMessage[];

    for (const message of messages) {
      message.reactions = await this.messageRepository.findReactions(message.id);
      message.attachments = await this.messageRepository.findAttachments(message.id);
    }

    return messages;
  }

  async createMessage(data: CreateMessageData): Promise<OutgoingMessage> {
    const { conversation_id, sender_id, content, type, reply_to, forwarded_from } = data;

    const conversation = await this.conversationRepository.findById(conversation_id);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    await this.assertConversationAccess(conversation, sender_id);

    const createdId = await this.messageRepository.create({
      conversation_id,
      sender_id,
      content,
      type: type || 'text',
      reply_to,
      forwarded_from,
    });

    const message = (await this.messageRepository.findByIdWithSender(createdId)) as OutgoingMessage;
    message.reactions = [];
    message.attachments = await this.messageRepository.findAttachments(createdId);

    const members = await this.conversationRepository.findMembers(conversation_id);
    const mentionedUserIds = extractMentionedUserIds(content, members);
    message.mentionedUserIds = mentionedUserIds;
    message.notifiedUserIds = await this.createMessageNotifications(
      message,
      sender_id,
      conversation_id,
      content,
      mentionedUserIds,
    );
    await this.createMentionNotifications(
      message,
      sender_id,
      conversation_id,
      content,
      mentionedUserIds,
    );

    return message;
  }

  /**
   * Forward an existing message into another conversation the sender can access.
   * Creates a new message row in the target conversation with the original
   * content prefixed and `forwarded_from` pointing at the source message.
   */
  async forwardMessage(
    sourceMessageId: number,
    targetConversationId: number,
    senderId: number,
  ): Promise<OutgoingMessage> {
    const source = await this.messageRepository.findById(sourceMessageId);
    if (!source) {
      throw new Error('Original message not found');
    }

    const targetConversation = await this.conversationRepository.findById(targetConversationId);
    if (!targetConversation) {
      throw new Error('Target conversation not found');
    }

    const sourceConversation = await this.conversationRepository.findById(source.conversation_id);
    if (sourceConversation) {
      await this.assertConversationAccess(sourceConversation, senderId);
    }
    await this.assertConversationAccess(targetConversation, senderId);

    const sourceSender = `${source.first_name || ''} ${source.last_name || ''}`.trim() || 'Unknown';
    const content = `Forwarded message from ${sourceSender}:\n\n${source.content}`;

    const createdId = await this.messageRepository.create({
      conversation_id: targetConversationId,
      sender_id: senderId,
      content,
      type: source.type || 'text',
      reply_to: null,
      forwarded_from: sourceMessageId,
    });

    const message = (await this.messageRepository.findByIdWithSender(createdId)) as OutgoingMessage;
    message.reactions = [];
    message.attachments = await this.messageRepository.findAttachments(createdId);
    message.mentionedUserIds = [];
    message.notifiedUserIds = await this.createMessageNotifications(
      message,
      senderId,
      targetConversationId,
      content,
      [],
    );

    return message;
  }

  /**
   * Create a file message (SRS FR-17): persists the message row plus the
   * attachment metadata and returns the full message for broadcasting.
   */
  async createFileMessage(data: CreateFileMessageData & { type?: string }): Promise<OutgoingMessage> {
    const { conversation_id, sender_id, file, type } = data;

    const conversation = await this.conversationRepository.findById(conversation_id);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    await this.assertConversationAccess(conversation, sender_id);

    const { file_name, file_url, file_type, file_size } = file;
    const messageId = await this.messageRepository.create({
      conversation_id,
      sender_id,
      content: type === 'voice' ? '' : file_name,
      type: type || 'file',
      reply_to: null,
    });

    await this.messageRepository.createAttachment({
      message_id: messageId,
      file_name,
      file_url,
      file_type,
      file_size,
    });

    const message = (await this.messageRepository.findByIdWithSender(messageId)) as OutgoingMessage;
    message.reactions = [];
    message.attachments = await this.messageRepository.findAttachments(messageId);
    message.mentionedUserIds = [];
    message.notifiedUserIds = await this.createMessageNotifications(
      message,
      sender_id,
      conversation_id,
      file_name,
      [],
    );

    return message;
  }

  async updateMessage(id: number, content: string, userId: number): Promise<OutgoingMessage> {
    const message = await this.messageRepository.findById(id);
    if (!message) {
      throw new Error('Message not found');
    }

    if (message.sender_id !== userId) {
      throw new Error('Unauthorized: You can only edit your own messages');
    }

    const updated = await this.messageRepository.update(id, content);
    if (!updated) {
      throw new Error('Failed to update message');
    }

    const refreshed = await this.messageRepository.findById(id);
    if (!refreshed) throw new Error('Message not found');
    return refreshed as OutgoingMessage;
  }

  async deleteMessage(id: number, userId: number): Promise<{ message: string; deletedMessage: OutgoingMessage }> {
    const message = await this.messageRepository.findById(id);
    if (!message) {
      throw new Error('Message not found');
    }

    if (message.sender_id !== userId) {
      throw new Error('Unauthorized: You can only delete your own messages');
    }

    const deleted = await this.messageRepository.softDelete(id);
    if (!deleted) {
      throw new Error('Failed to delete message');
    }

    return {
      message: 'Message deleted successfully',
      deletedMessage: { ...message, deleted_at: null } as OutgoingMessage,
    };
  }

  async pinMessage(id: number, userId: number): Promise<OutgoingMessage> {
    const message = await this.messageRepository.findById(id);
    if (!message) {
      throw new Error('Message not found');
    }

    const conversation = await this.conversationRepository.findById(message.conversation_id);
    if (conversation) {
      await this.assertConversationAccess(conversation, userId);
    }

    const updated = await this.messageRepository.setPinned(id, true);
    if (!updated) {
      throw new Error('Failed to pin message');
    }

    const refreshed = await this.messageRepository.findById(id);
    if (!refreshed) throw new Error('Message not found');
    return refreshed as OutgoingMessage;
  }

  async unpinMessage(id: number, userId: number): Promise<OutgoingMessage> {
    const message = await this.messageRepository.findById(id);
    if (!message) {
      throw new Error('Message not found');
    }

    const conversation = await this.conversationRepository.findById(message.conversation_id);
    if (conversation) {
      await this.assertConversationAccess(conversation, userId);
    }

    const updated = await this.messageRepository.setPinned(id, false);
    if (!updated) {
      throw new Error('Failed to unpin message');
    }

    const refreshed = await this.messageRepository.findById(id);
    if (!refreshed) throw new Error('Message not found');
    return refreshed as OutgoingMessage;
  }

  /**
   * Idempotent reaction add (SRS FR-16). POST /reactions means "ensure this
   * reaction exists": re-adding a reaction the user already placed succeeds
   * and returns the current reaction list — clients with stale local state
   * (e.g. a reaction added from another device) no longer trigger a 400.
   */
  async addReaction(
    messageId: number,
    userId: number,
    reaction: string,
  ): Promise<{ conversationId: number; reactions: unknown[] }> {
    const message = await this.messageRepository.findById(messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    const conversation = await this.conversationRepository.findById(message.conversation_id);
    if (conversation) {
      await this.assertConversationAccess(conversation, userId);
    }

    await this.reactionRepository.add(messageId, userId, reaction);

    return {
      conversationId: message.conversation_id,
      reactions: await this.messageRepository.findReactions(messageId),
    };
  }

  /** Idempotent reaction removal — deleting a missing reaction succeeds. */
  async removeReaction(
    messageId: number,
    userId: number,
    reaction: string,
  ): Promise<{ conversationId: number; reactions: unknown[] }> {
    const message = await this.messageRepository.findById(messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    const conversation = await this.conversationRepository.findById(message.conversation_id);
    if (conversation) {
      await this.assertConversationAccess(conversation, userId);
    }

    await this.reactionRepository.remove(messageId, userId, reaction);

    return {
      conversationId: message.conversation_id,
      reactions: await this.messageRepository.findReactions(messageId),
    };
  }

  /**
   * Create a `new_message` notification for every other member of the
   * conversation (SRS FR-14 / US-16). Members that were @mentioned get the
   * more specific `mention` notification instead (no duplicate rows).
   * @returns {number[]} Ids of users who received a new_message notification
   */
  async createMessageNotifications(
    message: OutgoingMessage,
    senderId: number,
    conversationId: number,
    content: string,
    mentionedUserIds: number[] = [],
  ): Promise<number[]> {
    const notified: number[] = [];
    try {
      const memberIds = await this.conversationRepository.findMemberIds(conversationId);
      const senderName =
        [message.first_name, message.last_name].filter(Boolean).join(' ').trim() || 'Someone';
      const snippet = content.length > 120 ? `${content.slice(0, 120)}…` : content;

      // Respect each member's notification preferences (category: messages).
      const recipientIds = this.notificationPreferences
        ? await this.notificationPreferences.filterEnabled('messages', memberIds.map(Number))
        : memberIds.map(Number);

      for (const memberId of recipientIds) {
        const numericId = Number(memberId);
        if (numericId === Number(senderId)) continue;
        if (mentionedUserIds.includes(numericId)) continue;

        await this.notificationRepository.create({
          user_id: memberId,
          actor_id: senderId,
          type: 'new_message',
          title: senderName,
          message: snippet,
          data: { conversationId, messageId: message.id },
        });
        notified.push(numericId);
      }
    } catch (error) {
      // Notification failures must never break message delivery.
      console.error('[MessageService] Failed to create notifications:', (error as Error).message);
    }
    return notified;
  }

  /**
   * Create `mention` notifications for @mentioned members (SRS FR-15).
   */
  async createMentionNotifications(
    message: OutgoingMessage,
    senderId: number,
    conversationId: number,
    content: string,
    mentionedUserIds: number[] = [],
  ): Promise<void> {
    if (!mentionedUserIds.length) return;
    try {
      const senderName =
        [message.first_name, message.last_name].filter(Boolean).join(' ').trim() || 'Someone';
      const snippet = content.length > 120 ? `${content.slice(0, 120)}…` : content;

      // Respect each mentioned user's preferences (category: mentions).
      const mentionRecipients = this.notificationPreferences
        ? await this.notificationPreferences.filterEnabled('mentions', mentionedUserIds.map(Number))
        : mentionedUserIds;

      for (const memberId of mentionRecipients) {
        if (Number(memberId) === Number(senderId)) continue;
        await this.notificationRepository.create({
          user_id: memberId,
          actor_id: senderId,
          type: 'mention',
          title: `${senderName} mentioned you`,
          message: snippet,
          data: { conversationId, messageId: message.id },
        });
      }
    } catch (error) {
      console.error('[MessageService] Failed to create mention notifications:', (error as Error).message);
    }
  }

  async searchMessages(companyId: number, search: string, filters: MessageSearchFilters = {}): Promise<OutgoingMessage[]> {
    const { conversation_id, page = 1, limit = 20 } = filters;
    return this.messageRepository.search(companyId, search, {
      conversation_id,
      page: parseInt(String(page)),
      limit: parseInt(String(limit)),
    });
  }

  async getThreadReplies(
    messageId: number,
    page = 1,
    limit = 30,
    userId: number | null = null,
  ): Promise<{ parent: OutgoingMessage; replies: OutgoingMessage[] }> {
    const parent = await this.messageRepository.findById(messageId);
    if (!parent) {
      throw new Error('Message not found');
    }

    if (userId) {
      await this.assertConversationAccess(
        { id: parent.conversation_id, type: '', name: null },
        userId,
      );
    }

    const replies = (await this.messageRepository.findThreadReplies(messageId, {
      page: parseInt(String(page)),
      limit: parseInt(String(limit)),
    })) as OutgoingMessage[];

    for (const reply of replies) {
      reply.reactions = await this.messageRepository.findReactions(reply.id);
      reply.attachments = await this.messageRepository.findAttachments(reply.id);
    }

    const parentWithSender = (await this.messageRepository.findByIdWithSender(messageId)) as OutgoingMessage;
    parentWithSender.reactions = await this.messageRepository.findReactions(messageId);
    parentWithSender.attachments = await this.messageRepository.findAttachments(messageId);

    return { parent: parentWithSender, replies };
  }
}
