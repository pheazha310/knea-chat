/**
 * MessageHandler — WebSocket events for messaging.
 * Persists through MessageService (business logic) and broadcasts the result
 * to conversation members. No SQL here.
 */
import type { MessageService } from '../services/Message.service';
import type { ConversationRepository } from '../repositories/conversationRepository';
import type { BroadcastToConversation } from './broadcast.utils';
import { sendToUser } from './connection.registry';
import type { AuthedSocket } from './connection.registry';
import { serializeMessage } from './message.utils';

export interface SendMessageEvent {
  conversationId?: number;
  content?: string;
  replyTo?: number | null;
}

export interface ForwardEvent {
  messageId?: number;
  targetConversationId?: number;
}

export interface EditEvent {
  messageId?: number;
  content?: string;
}

export interface DeleteEvent {
  messageId?: number;
}

export interface PinEvent {
  messageId?: number;
}

export interface JoinEvent {
  channelId?: number;
  conversationId?: number;
}

export interface LeaveEvent {
  channelId?: number;
  conversationId?: number;
}

export class MessageHandler {
  constructor(
    private messageService: MessageService,
    private conversationRepository: ConversationRepository,
    private broadcastToConversation: BroadcastToConversation,
  ) {}

  async handleSendMessage(ws: AuthedSocket, event: SendMessageEvent): Promise<void> {
    try {
      // NOTE: the event envelope itself carries `type` = 'send_message' (the
      // event name), so we must NOT use it as the message type. The client UI
      // only sends text over WebSocket (files go through the upload endpoint),
      // so we always default to 'text'.
      const { conversationId, content, replyTo } = event;

      if (!conversationId || !content) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Missing required fields: conversationId, content',
        }));
        return;
      }

      const message = await this.messageService.createMessage({
        conversation_id: conversationId,
        sender_id: ws.userId,
        content,
        type: 'text',
        reply_to: replyTo,
      });

      const serialized = serializeMessage(message);

      const messageData = {
        type: 'receive_message',
        message: serialized,
      };

      console.log(`📤 Broadcasting message in conversation ${conversationId}`);

      // Deliver to every connected member except the sender.
      await this.broadcastToConversation(conversationId, messageData, {
        excludeUserId: ws.userId,
      });

      // Real-time notifications (SRS FR-14 / FR-15): push a `notification`
      // event so the recipient bells update without a page refresh.
      const { mentionedUserIds = [], notifiedUserIds = [] } = message;
      const snippet = content.length > 120 ? `${content.slice(0, 120)}…` : content;
      const senderName =
        [message.first_name, message.last_name].filter(Boolean).join(' ').trim() || 'Someone';

      for (const userId of mentionedUserIds) {
        if (Number(userId) === Number(ws.userId)) continue;
        sendToUser(userId, JSON.stringify({
          type: 'notification',
          data: {
            type: 'mention',
            title: `${senderName} mentioned you`,
            message: snippet,
            conversationId: Number(conversationId),
            messageId: message.id,
          },
        }));
      }

      for (const userId of notifiedUserIds) {
        if (Number(userId) === Number(ws.userId)) continue;
        sendToUser(userId, JSON.stringify({
          type: 'notification',
          data: {
            type: 'new_message',
            title: senderName,
            message: snippet,
            conversationId: Number(conversationId),
            messageId: message.id,
          },
        }));
      }

      ws.send(JSON.stringify({
        type: 'message_sent_ack',
        message: 'Message sent successfully',
        data: serialized,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      console.error('Error in handleSendMessage:', (error as Error).message);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to send message: ' + (error as Error).message,
      }));
    }
  }

  async handleForwardMessage(ws: AuthedSocket, event: ForwardEvent): Promise<void> {
    try {
      const { messageId, targetConversationId } = event;

      if (!messageId || !targetConversationId) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Missing required fields: messageId, targetConversationId',
        }));
        return;
      }

      const message = await this.messageService.forwardMessage(messageId, targetConversationId, ws.userId);
      const serialized = serializeMessage(message);

      const forwardData = {
        type: 'message_forwarded',
        message: serialized,
      };

      await this.broadcastToConversation(targetConversationId, forwardData, {
        excludeUserId: ws.userId,
      });

      ws.send(JSON.stringify({
        type: 'message_forwarded_ack',
        messageId: message.id,
        targetConversationId,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      console.error('Error in handleForwardMessage:', (error as Error).message);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to forward message: ' + (error as Error).message,
      }));
    }
  }

  async handleMessageEdited(ws: AuthedSocket, event: EditEvent): Promise<void> {
    try {
      const { messageId, content } = event;

      if (!messageId || !content) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Missing required fields: messageId, content',
        }));
        return;
      }

      const message = await this.messageService.updateMessage(messageId, content, ws.userId);

      const editData = {
        type: 'message_updated',
        message: {
          id: message.id,
          conversationId: message.conversation_id,
          content: message.content,
          updatedAt: message.updated_at,
        },
      };

      await this.broadcastToConversation(message.conversation_id, editData);

      ws.send(JSON.stringify({
        type: 'message_edited_ack',
        messageId: message.id,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      console.error('Error in handleMessageEdited:', (error as Error).message);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to edit message: ' + (error as Error).message,
      }));
    }
  }

  async handleMessageDeleted(ws: AuthedSocket, event: DeleteEvent): Promise<void> {
    try {
      const { messageId } = event;

      if (!messageId) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Missing required field: messageId',
        }));
        return;
      }

      const result = await this.messageService.deleteMessage(messageId, ws.userId);
      const deletedMessage = result.deletedMessage;

      if (deletedMessage) {
        const deleteData = {
          type: 'message_deleted',
          message: {
            id: deletedMessage.id,
            conversationId: deletedMessage.conversation_id,
            deletedAt: new Date().toISOString(),
          },
        };

        await this.broadcastToConversation(deletedMessage.conversation_id, deleteData);
      }

      ws.send(JSON.stringify({
        type: 'message_deleted_ack',
        messageId: messageId,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      console.error('Error in handleMessageDeleted:', (error as Error).message);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to delete message: ' + (error as Error).message,
      }));
    }
  }

  async handleMessagePinned(ws: AuthedSocket, event: PinEvent, pinned: boolean): Promise<void> {
    try {
      const { messageId } = event;

      if (!messageId) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Missing required field: messageId',
        }));
        return;
      }

      const message = pinned
        ? await this.messageService.pinMessage(messageId, ws.userId)
        : await this.messageService.unpinMessage(messageId, ws.userId);

      const pinData = {
        type: pinned ? 'message_pinned' : 'message_unpinned',
        message: {
          id: message.id,
          conversationId: message.conversation_id,
          isPinned: pinned,
        },
      };

      await this.broadcastToConversation(message.conversation_id, pinData, {
        excludeUserId: ws.userId,
      });

      ws.send(JSON.stringify({
        type: pinned ? 'message_pinned_ack' : 'message_unpinned_ack',
        messageId: message.id,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      console.error(`Error in ${pinned ? 'handleMessagePinned' : 'handleMessageUnpinned'}:`, (error as Error).message);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to update pin state: ' + (error as Error).message,
      }));
    }
  }

  async handleJoinChannel(ws: AuthedSocket, event: JoinEvent): Promise<void> {
    try {
      const { channelId, conversationId } = event;

      const targetId = conversationId || channelId;

      if (!targetId) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Missing required field: channelId (or conversationId)',
        }));
        return;
      }

      const conversation = await this.conversationRepository.findById(targetId);
      if (!conversation) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Conversation not found',
        }));
        return;
      }

      // Team conversations are restricted to team members + privileged roles;
      // other conversation types require conversation membership.
      const canAccess =
        conversation.type === 'team'
          ? await this.conversationRepository.canAccessTeamConversation(
              conversation.name || '',
              ws.userId,
            )
          : await this.conversationRepository.isMember(targetId, ws.userId);
      if (!canAccess) {
        ws.send(JSON.stringify({
          type: 'error',
          message:
            conversation.type === 'team'
              ? 'You must be a member of this team to access its conversation'
              : 'You are not a member of this conversation',
        }));
        return;
      }

      ws.send(JSON.stringify({
        type: 'joined_channel',
        channelId: targetId,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      console.error('Error in handleJoinChannel:', (error as Error).message);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to join channel: ' + (error as Error).message,
      }));
    }
  }

  async handleLeaveChannel(ws: AuthedSocket, event: JoinEvent): Promise<void> {
    try {
      const { channelId, conversationId } = event;

      const targetId = conversationId || channelId;

      if (!targetId) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Missing required field: channelId (or conversationId)',
        }));
        return;
      }

      ws.send(JSON.stringify({
        type: 'left_channel',
        channelId: targetId,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      console.error('Error in handleLeaveChannel:', (error as Error).message);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to leave channel: ' + (error as Error).message,
      }));
    }
  }
}
