/**
 * BookmarkRepository — data-access layer for the `message_bookmarks` table.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { BookmarkRow, BookmarkFilters } from '../types';

export class BookmarkRepository {
  constructor(private db: Db) {}

  async create(data: { message_id: number; user_id: number }): Promise<number> {
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO message_bookmarks (message_id, user_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE created_at = created_at`,
      [data.message_id, data.user_id],
    );
    return result.insertId;
  }

  async remove(messageId: number, userId: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'DELETE FROM message_bookmarks WHERE message_id = ? AND user_id = ?',
      [messageId, userId],
    );
    return result.affectedRows > 0;
  }

  async findByMessage(messageId: number): Promise<BookmarkRow[]> {
    return this.db.query<BookmarkRow[]>(
      'SELECT * FROM message_bookmarks WHERE message_id = ?',
      [messageId],
    );
  }

  async findByUser(filters: BookmarkFilters): Promise<BookmarkRow[]> {
    const { userId, page = 1, limit = 20 } = filters;
    return this.db.query<BookmarkRow[]>(
      `SELECT mb.*, m.conversation_id, m.content, m.created_at as message_created_at,
              u.first_name, u.last_name, u.email, u.profile_picture
       FROM message_bookmarks mb
       JOIN messages m ON m.id = mb.message_id
       JOIN users u ON u.id = m.sender_id
       WHERE mb.user_id = ? AND m.deleted_at IS NULL
       ORDER BY mb.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, parseInt(String(limit)), (parseInt(String(page)) - 1) * parseInt(String(limit))],
    );
  }

  async exists(messageId: number, userId: number): Promise<boolean> {
    const [row] = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM message_bookmarks WHERE message_id = ? AND user_id = ?',
      [messageId, userId],
    );
    return !!row;
  }
}
