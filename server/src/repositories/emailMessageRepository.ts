/**
 * EmailMessageRepository — data-access layer for `email_messages` (migration
 * 031): one row per inbound/outbound email with its RFC 5322 threading
 * headers and outbound delivery status. Contains SQL only.
 *
 * Every Message-ID passed in or stored here is NORMALIZED (lower-case, no
 * `<>` — see normalizeMessageId) so lookups are plain indexed equality.
 */
import type { Db, ResultSetHeader } from '../database/connection';

export type EmailDeliveryStatus = 'pending' | 'sent' | 'failed';

export interface EmailMessageRow {
  id: number;
  message_id: number;
  conversation_id: number;
  direction: 'inbound' | 'outbound';
  rfc_message_id: string | null;
  in_reply_to: string | null;
  references_ids: string | null;
  subject: string | null;
  from_address: string | null;
  to_address: string | null;
  delivery_status: EmailDeliveryStatus | null;
  delivery_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateEmailMessageData {
  message_id: number;
  conversation_id: number;
  direction: 'inbound' | 'outbound';
  rfc_message_id: string | null;
  in_reply_to?: string | null;
  references_ids?: string[] | null;
  subject?: string | null;
  from_address?: string | null;
  to_address?: string | null;
  delivery_status?: EmailDeliveryStatus | null;
}

export class EmailMessageRepository {
  constructor(private db: Db) {}

  async create(data: CreateEmailMessageData): Promise<number> {
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO email_messages
         (message_id, conversation_id, direction, rfc_message_id, in_reply_to,
          references_ids, subject, from_address, to_address, delivery_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.message_id,
        data.conversation_id,
        data.direction,
        data.rfc_message_id,
        data.in_reply_to ?? null,
        data.references_ids?.length ? data.references_ids.join(' ') : null,
        data.subject ?? null,
        data.from_address ?? null,
        data.to_address ?? null,
        data.delivery_status ?? null,
      ],
    );
    return result.insertId;
  }

  /** pending → sent. Only called after the SMTP server accepted the message. */
  async markSent(messageId: number): Promise<void> {
    await this.db.query(
      `UPDATE email_messages SET delivery_status = 'sent', delivery_error = NULL WHERE message_id = ?`,
      [messageId],
    );
  }

  /** pending → failed, with an already-sanitized, agent-safe reason. */
  async markFailed(messageId: number, error: string): Promise<void> {
    await this.db.query(
      `UPDATE email_messages SET delivery_status = 'failed', delivery_error = ? WHERE message_id = ?`,
      [error.slice(0, 255), messageId],
    );
  }

  /**
   * The conversation holding the newest email (either direction) whose own
   * Message-ID is one of `rfcMessageIds` — i.e. "which thread does this reply
   * belong to?". Matching outbound rows too means a customer replying to an
   * agent-started thread is found.
   */
  async findConversationIdByRfcMessageIds(rfcMessageIds: string[]): Promise<number | null> {
    if (rfcMessageIds.length === 0) return null;
    const placeholders = rfcMessageIds.map(() => '?').join(',');
    const rows = await this.db.query<Array<{ conversation_id: number }>>(
      `SELECT conversation_id FROM email_messages
       WHERE rfc_message_id IN (${placeholders})
       ORDER BY id DESC
       LIMIT 1`,
      rfcMessageIds,
    );
    return rows[0]?.conversation_id ?? null;
  }

  /**
   * The email an agent reply should answer: the customer's latest email, or —
   * for an agent-started thread with no customer email yet — the latest email
   * we successfully sent. Failed/pending sends never become a thread parent:
   * the customer never received them.
   */
  async findReplyParent(conversationId: number): Promise<EmailMessageRow | null> {
    const rows = await this.db.query<EmailMessageRow[]>(
      `SELECT * FROM email_messages
       WHERE conversation_id = ?
         AND rfc_message_id IS NOT NULL
         AND (direction = 'inbound' OR delivery_status = 'sent')
       ORDER BY direction = 'inbound' DESC, id DESC
       LIMIT 1`,
      [conversationId],
    );
    return rows[0] || null;
  }
}

export default EmailMessageRepository;
