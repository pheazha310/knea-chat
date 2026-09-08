// Conversation domain model — MVVM Model layer.
// Holds the `Conversation` entity plus `ConversationModel`, the data access
// for the /conversations endpoints.
import api from '../services/api';
import type { ConversationMember } from './User';
import type { Message } from './Message';

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
