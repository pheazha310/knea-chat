/**
 * ReactionRepository — data-access layer for the `message_reactions` table.
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { ReactionRow } from '../types';

export class ReactionRepository {
  constructor(private db: Db) {}

  /**
   * Idempotent add: INSERT ... ON DUPLICATE KEY UPDATE means re-adding a
   * reaction the user already placed is a no-op instead of a duplicate-key
   * error. The caller treats a falsy return (no-op / no insert) the same as
   * success — POST /reactions means "ensure this reaction exists".
   */
  async add(messageId: number, userId: number, reaction: string): Promise<number | null> {
    try {
      const result = await this.db.query<ResultSetHeader>(
        `INSERT INTO message_reactions (message_id, user_id, reaction)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE reaction = reaction`,
        [messageId, userId, reaction],
      );
      return result.insertId;
    } catch (error) {
      throw error;
    }
  }

  async remove(messageId: number, userId: number, reaction: string): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND reaction = ?',
      [messageId, userId, reaction],
    );
    return result.affectedRows > 0;
  }

  async findByMessage(messageId: number): Promise<ReactionRow[]> {
    return this.db.query<ReactionRow[]>(
      `SELECT mr.*, u.first_name, u.last_name, u.email, u.profile_picture
       FROM message_reactions mr
       JOIN users u ON mr.user_id = u.id
       WHERE mr.message_id = ?`,
      [messageId],
    );
  }
}
