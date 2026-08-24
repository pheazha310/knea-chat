/**
 * TypingHandler — WebSocket events for typing indicators.
 * Broadcasts typing_start/typing_stop to the other conversation members.
 */
import type { BroadcastToConversation } from './broadcast.utils';
import type { AuthedSocket } from './connection.registry';

export interface TypingEvent {
  conversationId?: number;
  channelId?: number;
}

export class TypingHandler {
  constructor(private broadcastToConversation: BroadcastToConversation) {}

  async handleTypingStart(ws: AuthedSocket, event: TypingEvent): Promise<void> {
    try {
      const { conversationId, channelId } = event;

      const targetId = conversationId || channelId;

      if (!targetId) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Missing conversationId or channelId',
        }));
        return;
      }

      const typingData = {
        type: 'typing_start',
        data: {
          conversationId: targetId,
          userId: ws.userId,
          userEmail: ws.email,
          timestamp: new Date().toISOString(),
        },
      };

      console.log(`⌨️ User ${ws.email} is typing in ${targetId}`);
      await this.broadcastToConversation(targetId, typingData, {
        excludeUserId: ws.userId,
      });
    } catch (error) {
      console.error('Error in handleTypingStart:', (error as Error).message);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to send typing indicator: ' + (error as Error).message,
      }));
    }
  }

  async handleTypingStop(ws: AuthedSocket, event: TypingEvent): Promise<void> {
    try {
      const { conversationId, channelId } = event;

      const targetId = conversationId || channelId;

      if (!targetId) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Missing conversationId or channelId',
        }));
        return;
      }

      const typingData = {
        type: 'typing_stop',
        data: {
          conversationId: targetId,
          userId: ws.userId,
          userEmail: ws.email,
          timestamp: new Date().toISOString(),
        },
      };

      console.log(`⌨️ User ${ws.email} stopped typing in ${targetId}`);
      await this.broadcastToConversation(targetId, typingData, {
        excludeUserId: ws.userId,
      });
    } catch (error) {
      console.error('Error in handleTypingStop:', (error as Error).message);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to stop typing indicator: ' + (error as Error).message,
      }));
    }
  }
}
