// Search model — MVVM Model layer.
// Holds the message/global-search entities plus `SearchModel`, the data access
// for the /search endpoints (⌘K quick search + the global Search view).
import api from '../services/api';
import type { ConversationType } from './Conversation';
import type { MessageType } from './Message';
import type { SharedFile } from './SharedFile';
import type { Task } from './Task';
import type { Team } from './Team';
import type { User } from './User';

export type SearchScope =
  | 'messages'
  | 'people'
  | 'teams'
  | 'channels'
  | 'files'
  | 'meetings'
  | 'tasks';

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
  /** Display name of the conversation the hit belongs to. */
  conversation_name?: string | null;
}

/** One page of results for a scope: rows plus the total match count. */
export interface SearchGroup<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface GlobalSearchFilters {
  q?: string;
  /** Person filter — sender / user / uploader / organizer / assignee. */
  person_id?: number;
  team_id?: number;
  department_id?: number;
  /** File type group token (image, video, audio, pdf, word, excel, …). */
  file_type?: string;
  /** Message type (text, image, file, voice, system). */
  message_type?: MessageType | 'system';
  /** Inclusive date range (YYYY-MM-DD). */
  date_from?: string;
  date_to?: string;
}

/** Overview response — every scope that has hits, with totals. */
export type GlobalSearchOverview = Partial<
  Record<
    SearchScope,
    | SearchGroup<MessageSearchResult>
    | SearchGroup<User>
    | SearchGroup<Team>
    | SearchGroup<SharedFile>
    | SearchGroup<Task>
  >
>;

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

  /** Global search — grouped overview of every scope. */
  global: (filters: GlobalSearchFilters) =>
    api.get<{ success: boolean; data: { groups: GlobalSearchOverview } }>(
      `/search/global${buildQuery(filters)}`,
    ),

  /** Global search — full paginated results for one scope. */
  globalScope: (scope: SearchScope, filters: GlobalSearchFilters) =>
    api.get<{ success: boolean; data: { result: SearchGroup<unknown> } }>(
      `/search/global/${scope}${buildQuery(filters)}`,
    ),
};

const buildQuery = (filters: GlobalSearchFilters): string => {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.person_id !== undefined) params.set('person_id', String(filters.person_id));
  if (filters.team_id !== undefined) params.set('team_id', String(filters.team_id));
  if (filters.department_id !== undefined) params.set('department_id', String(filters.department_id));
  if (filters.file_type) params.set('file_type', filters.file_type);
  if (filters.message_type) params.set('message_type', filters.message_type);
  if (filters.date_from) params.set('date_from', filters.date_from);
  if (filters.date_to) params.set('date_to', filters.date_to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};
