/**
 * MessageRepository — data-access layer for the `messages` and `attachments`
 * tables. Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type {
  CreateMessageData,
  MessageAttachment,
  MessageRow,
  MessageSearchFilters,
  ReactionRow,
} from '../types';

export class MessageRepository {
  constructor(private db: Db) {}

  async findAll(filters: { conversationId: number; page?: number; limit?: number }): Promise<MessageRow[]> {
    const { conversationId, page = 1, limit = 30 } = filters;
    return this.db.query<MessageRow[]>(
      `SELECT m.*, u.first_name, u.last_name, u.email, u.profile_picture
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = ? AND m.deleted_at IS NULL
       ORDER BY m.created_at ASC
       LIMIT ? OFFSET ?`,
      [conversationId, parseInt(String(limit)), (parseInt(String(page)) - 1) * parseInt(String(limit))],
    );
  }

  async findById(id: number): Promise<MessageRow | null> {
    const messages = await this.db.query<MessageRow[]>(
      'SELECT * FROM messages WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return messages[0] || null;
  }

  async findByIdWithSender(id: number): Promise<MessageRow | null> {
    const messages = await this.db.query<MessageRow[]>(
      `SELECT m.*, u.first_name, u.last_name, u.email, u.profile_picture, u.status
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.id = ? AND m.deleted_at IS NULL`,
      [id],
    );
    return messages[0] || null;
  }

  async create(data: CreateMessageData): Promise<number> {
    const { conversation_id, sender_id, content, type, reply_to, forwarded_from } = data;
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO messages (conversation_id, sender_id, content, type, reply_to, forwarded_from) VALUES (?, ?, ?, ?, ?, ?)',
      [conversation_id, sender_id, content, type || 'text', reply_to || null, forwarded_from || null],
    );
    return result.insertId;
  }

  async update(id: number, content: string): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('UPDATE messages SET content = ? WHERE id = ?', [
      content,
      id,
    ]);
    return result.affectedRows > 0;
  }

  async softDelete(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'UPDATE messages SET deleted_at = NOW() WHERE id = ?',
      [id],
    );
    return result.affectedRows > 0;
  }

  async findReactions(messageId: number): Promise<ReactionRow[]> {
    return this.db.query<ReactionRow[]>(
      `SELECT mr.*, u.first_name, u.last_name, u.email, u.profile_picture
       FROM message_reactions mr
       JOIN users u ON mr.user_id = u.id
       WHERE mr.message_id = ?`,
      [messageId],
    );
  }

  async findAttachments(messageId: number): Promise<MessageAttachment[]> {
    return this.db.query<MessageAttachment[]>(
      'SELECT * FROM attachments WHERE message_id = ? ORDER BY uploaded_at ASC',
      [messageId],
    );
  }

  /** Persist an uploaded file's metadata alongside its message row (SRS FR-17). */
  async createAttachment(data: {
    message_id: number;
    file_name: string;
    file_url: string;
    file_type: string | null;
    file_size: number | null;
  }): Promise<number> {
    const { message_id, file_name, file_url, file_type, file_size } = data;
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO attachments (message_id, file_name, file_url, file_type, file_size)
       VALUES (?, ?, ?, ?, ?)`,
      [message_id, file_name, file_url, file_type || null, file_size || null],
    );
    return result.insertId;
  }

  async setPinned(id: number, pinned: boolean): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('UPDATE messages SET is_pinned = ? WHERE id = ?', [
      pinned ? 1 : 0,
      id,
    ]);
    return result.affectedRows > 0;
  }

  /**
   * Search messages the searcher is allowed to see. Channels stay
   * company-wide (permissive model); team conversations are restricted to
   * team members + privileged roles, so their content never leaks into a
   * non-member's search results.
   */
  async search(userId: number, search: string, filters: MessageSearchFilters = {}): Promise<MessageRow[]> {
    const { conversation_id, page = 1, limit = 20 } = filters;
    let sql = `SELECT m.*, u.first_name, u.last_name, u.email, u.profile_picture, c.type as conversation_type
               FROM messages m
               JOIN users u ON m.sender_id = u.id
               JOIN conversations c ON m.conversation_id = c.id
               JOIN users searcher ON searcher.id = ?
               WHERE m.content LIKE ? AND m.deleted_at IS NULL
                 AND EXISTS (
                   SELECT 1 FROM conversation_members cm
                   JOIN users cu ON cu.id = cm.user_id
                   WHERE cm.conversation_id = c.id AND cu.company_id = searcher.company_id
                 )
                 AND (
                   c.type <> 'team'
                   OR searcher.role IN ('super_admin', 'admin', 'manager')
                   OR EXISTS (
                     SELECT 1 FROM teams t
                     JOIN team_members tm ON tm.team_id = t.id
                     WHERE t.name = c.name AND tm.user_id = searcher.id AND t.company_id = searcher.company_id
                   )
                 )`;
    const params: unknown[] = [userId, `%${search}%`];

    if (conversation_id) {
      sql += ' AND m.conversation_id = ?';
      params.push(conversation_id);
    }

    sql += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(String(limit)), (parseInt(String(page)) - 1) * parseInt(String(limit)));

    return this.db.query<MessageRow[]>(sql, params);
  }

  async findThreadReplies(messageId: number, filters: { page?: number; limit?: number }): Promise<MessageRow[]> {
    const { page = 1, limit = 30 } = filters;
    return this.db.query<MessageRow[]>(
      `SELECT m.*, u.first_name, u.last_name, u.email, u.profile_picture
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.reply_to = ? AND m.deleted_at IS NULL
       ORDER BY m.created_at ASC
       LIMIT ? OFFSET ?`,
      [messageId, parseInt(String(limit)), (parseInt(String(page)) - 1) * parseInt(String(limit))],
    );
  }
}
