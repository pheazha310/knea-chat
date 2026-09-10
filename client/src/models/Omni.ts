// Omni-channel domain model — MVVM Model layer.
// Data access for the channel-agnostic /api/omni endpoints used by the Omni
// Inbox (agent replies, assignment, open/close). The Telegram channel keeps
// its own model for its channel-specific endpoints (/api/telegram/*); this
// model is the generic surface shared by every channel.
import api from '../services/api';
import type { Message } from './Message';

export const OmniModel = {
  /** Reply to a customer through the conversation's channel adapter. */
  reply: (conversationId: number, text: string, replyToMessageId?: number) =>
    api.post<{ success: boolean; data: { message: Message } }>(
      `/omni/conversations/${conversationId}/messages`,
      {
        text,
        ...(replyToMessageId ? { replyToMessageId } : {}),
      },
    ),
  /** Claim / assign a conversation to an agent (defaults to self). */
  assign: (conversationId: number, agentId?: number) =>
    api.post<{ success: boolean; data: { assignedAgentId: number | null } }>(
      `/omni/conversations/${conversationId}/assign`,
      agentId ? { agentId } : {},
    ),
  /** Unassign the agent from a conversation. */
  unassign: (conversationId: number) =>
    api.delete<{ success: boolean; data: { assignedAgentId: number | null } }>(
      `/omni/conversations/${conversationId}/assign`,
    ),
  /** Open / close a conversation in the inbox. */
  setStatus: (conversationId: number, status: 'open' | 'closed') =>
    api.patch<{ success: boolean; data: { conversationId: number; status: 'open' | 'closed' } }>(
      `/omni/conversations/${conversationId}/status`,
      { status },
    ),
};