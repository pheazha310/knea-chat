// Search model — MVVM Model layer.
// Holds the `MessageSearchResult` entity plus `SearchModel`, the data access
// for the /search endpoints.
import api from '../services/api';
import type { ConversationType } from './Conversation';
import type { MessageType } from './Message';
import type { User } from './User';

export interface MessageSearchResult {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  type: MessageType;
  reply_to?: number | null;
  created_at: string;
  deleted_at?: string | null;
  first_name?: string;
  last_name?: string;
  email?: string;
  profile_picture?: string | null;
  conversation_type?: ConversationType;
}

export const SearchModel = {
  messages: (q: string, conversationId?: number) =>
    api.get<{ success: boolean; data: { results: MessageSearchResult[] } }>(
      `/search/messages?q=${encodeURIComponent(q)}`,
      { params: conversationId ? { conversation_id: conversationId } : {} },
    ),
  users: (q: string) =>
    api.get<{ success: boolean; data: { results: User[] } }>(
      `/search/users?q=${encodeURIComponent(q)}`,
    ),
};
