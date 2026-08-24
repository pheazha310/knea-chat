/**
 * Message types — mirror the `messages`/`attachments` tables plus the joined
 * sender columns returned by the message queries.
 */
import type { ReactionRow } from './Reaction';

export interface MessageRow {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  type: string;
  reply_to: number | null;
  forwarded_from?: number | null;
  is_pinned: number;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  // Joined sender columns (findAll / findByIdWithSender / search)
  first_name?: string;
  last_name?: string;
  email?: string;
  profile_picture?: string | null;
  status?: string;
  conversation_type?: string;
}

export interface MessageAttachment {
  id: number;
  message_id: number;
  file_name: string;
  file_url: string;
  file_type: string | null;
  file_size: number | null;
  uploaded_at: Date | string;
}

/** Full message as returned by services (row + reactions/attachments/mentions). */
export interface OutgoingMessage extends MessageRow {
  reactions?: ReactionRow[];
  attachments?: MessageAttachment[];
  mentionedUserIds?: number[];
  notifiedUserIds?: number[];
}

export interface CreateMessageData {
  conversation_id: number;
  sender_id: number;
  content: string;
  type?: string;
  reply_to?: number | null;
  forwarded_from?: number | null;
}

export interface CreateFileMessageData {
  conversation_id: number;
  sender_id: number;
  file: {
    file_name: string;
    file_url: string;
    file_type: string | null;
    file_size: number | null;
  };
}

export interface MessageSearchFilters {
  conversation_id?: string;
  page?: number;
  limit?: number;
}
