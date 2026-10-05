// Conversation domain model — MVVM Model layer.
// Holds the `Conversation` entity plus `ConversationModel`, the data access
// for the /conversations endpoints.
import api from '../../../shared/lib/api';
import type { ConversationMember } from '../../user/model/User';
import type { Message } from '../../message/model/Message';

export type ConversationType = 'direct' | 'group' | 'channel' | 'team';

export interface Conversation {
  id: number;
  type: ConversationType;
  created_by: number;
  name?: string | null;
  description?: string | null;
  is_active?: number;
  member_count?: number;
  message_count?: number;
  last_message_content?: string | null;
  last_message_at?: string | null;
  members?: ConversationMember[];
  created_at?: string;
  updated_at?: string;
  /** Omni-channel adapter backing this conversation (e.g. 'telegram'). */
  channel?: string;
  /** Agent assigned to this omni-channel conversation (nullable). */
  assigned_agent_id?: number | null;
  /** Display name of the assigned agent. */
  assigned_agent_name?: string | null;
  /** Inbox status for omni-channel conversations ('open' / 'closed'). */
  external_status?: 'open' | 'closed' | null;
  /** Consecutive failed agent replies through the channel (0 = healthy). */
  delivery_fail_count?: number;
  /** Provider error from the last failed reply (e.g. "chat not found"). */
  last_delivery_error?: string | null;
  /** When the last delivery failure was recorded. */
  last_delivery_failure_at?: string | null;
  /** Sender identity for external inbox conversations. */
  external_contact_name?: string | null;
  external_contact_email?: string | null;
}

/** Short customer label for inbox conversations, with a readable email fallback. */
export function conversationContactName(
  conversation: Conversation,
  currentUserId: number | null,
): string | null {
  const other = conversation.members?.find((member) => member.id !== currentUserId);
  const email = conversation.external_contact_email || other?.email || null;
  const knownName = conversation.external_contact_name?.trim();

  if (knownName && knownName.toLowerCase() !== email?.toLowerCase() && knownName !== 'Email Customer') {
    return knownName;
  }
  if (email) {
    const localPart = email.split('@')[0] || '';
    const shortName = localPart
      .replace(/[._+-]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return shortName || email;
  }
  return knownName || conversation.name || null;
}

export const ConversationModel = {
  getAll: () =>
    api.get<{
      success: boolean;
      data: { conversations: Conversation[] };
    }>('/conversations'),
  get: (id: number) =>
    api.get<{ success: boolean; data: { conversation: Conversation } }>(
      `/conversations/${id}`,
    ),
  addMember: (id: number, userId: number) =>
    api.post<{ success: boolean; message: string }>(`/conversations/${id}/members`, {
      user_id: userId,
    }),
  create: (data: {
    type: 'direct' | 'group' | 'channel' | 'team';
    name?: string;
    description?: string;
    participant_ids?: number[];
  }) =>
    api.post<{ success: boolean; data: { conversation: Conversation } }>(
      '/conversations',
      data,
    ),
  createDirect: (userId: number) =>
    api.post<{ success: boolean; data: { conversation: Conversation } }>(
      '/conversations/direct',
      { userId },
    ),
  getMessages: (id: number) =>
    api.get<{ success: boolean; data: { messages: Message[] } }>(
      `/conversations/${id}/messages`,
    ),
};
