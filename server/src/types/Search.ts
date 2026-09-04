/**
 * Global search types — the seven workspace scopes searched by the Search
 * view (messages, people, teams, channels, files, meetings, tasks) plus the
 * shared filter bag applied to the scopes where each filter makes sense.
 *
 * Result rows are the existing domain row types (they already carry the
 * joined sender/uploader/organizer/assignee columns the UI needs); a few
 * scopes add one extra joined column via an extended interface below.
 */
import type { ChannelRow } from './Channel';
import type { MeetingRow } from './Meeting';
import type { MessageRow } from './Message';
import type { SharedFileRow } from './SharedFile';
import type { TaskRow } from './Task';
import type { TeamRow } from './Team';
import type { UserRow } from './User';

export type SearchScope = 'messages' | 'people' | 'teams' | 'channels' | 'files' | 'meetings' | 'tasks';

/** Search scopes with at least one result group, ordered for display. */
export const SEARCH_SCOPES: SearchScope[] = [
  'messages',
  'people',
  'teams',
  'channels',
  'files',
  'meetings',
  'tasks',
];

/**
 * Filters shared by the Search view. Each scope applies the subset that is
 * meaningful to it (e.g. `file_type` only narrows files, `message_type` only
 * messages). `q` is optional — filtering alone is a valid query.
 */
export interface GlobalSearchFilters {
  q?: string;
  /** Person filter — the sender / user / uploader / organizer / assignee. */
  person_id?: number;
  team_id?: number;
  department_id?: number;
  file_type?: string;
  message_type?: string;
  /** Inclusive date range (YYYY-MM-DD). */
  date_from?: string;
  date_to?: string;
}

/** One page of results for a scope: rows plus the total match count. */
export interface SearchGroupResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** Message hits also carry the conversation's display name. */
export interface SearchMessageRow extends MessageRow {
  conversation_name?: string | null;
}

/** Channel hits also carry the team they belong to (if any). */
export interface SearchChannelRow extends ChannelRow {
  team_name?: string | null;
}

/** Team hits also carry their department's name. */
export interface SearchTeamRow extends TeamRow {
  department_name?: string | null;
}

export interface SearchOverviewGroups {
  messages: SearchGroupResult<SearchMessageRow>;
  people: SearchGroupResult<UserRow>;
  teams: SearchGroupResult<SearchTeamRow>;
  channels: SearchGroupResult<SearchChannelRow>;
  files: SearchGroupResult<SharedFileRow>;
  meetings: SearchGroupResult<MeetingRow>;
  tasks: SearchGroupResult<TaskRow>;
}
