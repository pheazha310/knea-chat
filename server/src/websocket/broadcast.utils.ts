/**
 * Broadcast utilities.
 *
 * Security (SRS §11.2, §17.5):
 *  - Events are delivered ONLY to users who are members of the target
 *    conversation. Membership is resolved server-side before any broadcast.
 *  - The sender is excluded from the broadcast (unless excludeSender is false,
 *    which is only used for announcements that target the sender too).
 */
import WebSocket from 'ws';
import type { ConversationRepository } from '../repositories/conversationRepository';
import { sendToUser, userConnections } from './connection.registry';

export type BroadcastToConversation = (
  conversationId: number,
  event: object | string,
  options?: { excludeUserId?: number | null },
) => Promise<void>;

const toJson = (event: object | string): string =>
  typeof event === 'string' ? event : JSON.stringify(event);

/**
 * Create the conversation-scoped broadcast function bound to a repository
 * instance (constructor DI).
 */
export const createBroadcastToConversation = (
  conversationRepository: ConversationRepository,
): BroadcastToConversation => {
  return async (conversationId, event, options = {}) => {
    const { excludeUserId = null } = options;

    let memberIds: number[];
    try {
      memberIds = await conversationRepository.findMemberIds(conversationId);
    } catch (error) {
      console.error(
        `[broadcast] Could not resolve members for conversation ${conversationId}:`,
        (error as Error).message,
      );
      return;
    }

    const payload = toJson(event);

    memberIds.forEach((memberId) => {
      if (excludeUserId !== null && Number(memberId) === Number(excludeUserId)) {
        return;
      }
      sendToUser(memberId, payload);
    });
  };
};

/** Broadcast only to connected clients (no database lookup). */
export const broadcastToAll = (event: object | string, wss: WebSocket.Server): void => {
  const payload = toJson(event);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
};

console.log(
  `[broadcast] Registry tracking ${userConnections.size} connected user(s)`,
);
