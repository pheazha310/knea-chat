/**
 * ReminderRepository — data-access layer for the `message_reminders` table.
 */
import type { Db, ResultSetHeader } from '../database/connection';

export interface ReminderRow {
  id: number;
  message_id: number;
  user_id: number;
  remind_at: Date | string;
  is_sent: number;
  created_at: Date | string;
}

export class ReminderRepository {
  constructor(private db: Db) {}

  async create(data: {
    message_id: number;
    user_id: number;
    remind_at: Date | string;
  }): Promise<number> {
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO message_reminders (message_id, user_id, remind_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE remind_at = VALUES(remind_at), is_sent = 0`,
      [data.message_id, data.user_id, data.remind_at],
    );
    return result.insertId;
  }

  async findDueReminders(now: Date | string): Promise<ReminderRow[]> {
    return this.db.query<ReminderRow[]>(
      `SELECT * FROM message_reminders
       WHERE is_sent = 0 AND remind_at <= ?
       ORDER BY remind_at ASC
       LIMIT 100`,
      [now],
    );
  }

  async markAsSent(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await this.db.query(
      `UPDATE message_reminders SET is_sent = 1 WHERE id IN (${placeholders})`,
      ids,
    );
  }

  async findByMessageAndUser(messageId: number, userId: number): Promise<ReminderRow | null> {
    const rows = await this.db.query<ReminderRow[]>(
      `SELECT * FROM message_reminders
       WHERE message_id = ? AND user_id = ? AND is_sent = 0`,
      [messageId, userId],
    );
    return rows[0] || null;
  }

  async delete(id: number, userId: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      `DELETE FROM message_reminders WHERE id = ? AND user_id = ?`,
      [id, userId],
    );
    return result.affectedRows > 0;
  }
}
