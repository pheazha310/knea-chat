/**
 * Omni-channel types — mirror the `external_contacts`, `external_conversations`
 * and `external_messages` tables. These keep external identities (e.g. the
 * Telegram user id) separate from KneaChat's internal user ids.
 */

/** Channels supported by the omni-channel layer (extensible per adapter). */
export type OmniChannel = 'telegram' | 'email' | 'website';

export interface ExternalContactRow {
  id: number;
  user_id: number;
  channel: string;
  external_contact_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  metadata: unknown | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ExternalConversationRow {
  id: number;
  conversation_id: number;
  contact_id: number;
  channel: string;
  status: 'open' | 'closed';
  assigned_agent_id: number | null;
  /** Consecutive failed agent replies (0 = healthy). Migration 028. */
  delivery_fail_count?: number;
  /** Provider error description from the last failed reply. */
  last_delivery_error?: string | null;
  /** When the last failure was recorded. */
  last_delivery_failure_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ExternalMessageRow {
  id: number;
  message_id: number;
  conversation_id: number;
  external_message_id: string | null;
  channel: string;
  direction: 'inbound' | 'outbound';
  sender_type: 'customer' | 'agent' | 'system';
  content: string;
  external_timestamp: Date | string | null;
  metadata: unknown | null;
  created_at: Date | string;
}

/** External conversation joined with its contact (used by the reply path). */
export interface ExternalConversationWithContact extends ExternalConversationRow {
  external_contact_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
}