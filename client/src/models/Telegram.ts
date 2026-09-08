// Telegram omni-channel domain model — MVVM Model layer.
// Data access for the /api/telegram endpoints used by the Unified Inbox
// (agent replies + health). No secrets live here.
import api from '../services/api';
import type { Message } from './Message';

export const TelegramModel = {
  /**
   * Reply to a Telegram customer from the Unified Inbox. The server resolves
   * the Telegram chat id from the stored external contact — the client only
   * sends the KneaChat conversation id.
   */
  reply: (conversationId: number, text: string, replyToMessageId?: number) =>
    api.post<{ success: boolean; data: { message: Message } }>('/telegram/messages', {
      conversationId,
      text,
      ...(replyToMessageId ? { replyToMessageId } : {}),
    }),
  /** Health probe — reports whether the bot is configured and reachable. */
  health: () =>
    api.get<{ success: boolean; connected: boolean }>('/telegram/health'),
  /** Claim / assign a Telegram conversation to an agent (defaults to self). */
  assign: (conversationId: number, agentId?: number) =>
    api.post<{ success: boolean; data: { assignedAgentId: number | null } }>(
      `/telegram/conversations/${conversationId}/assign`,
      agentId ? { agentId } : {},
    ),
  /** Unassign the agent from a Telegram conversation. */
  unassign: (conversationId: number) =>
    api.delete<{ success: boolean; data: { assignedAgentId: number | null } }>(
      `/telegram/conversations/${conversationId}/assign`,
    ),
};