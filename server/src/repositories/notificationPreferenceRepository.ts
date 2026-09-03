/**
 * NotificationPreferenceRepository — data-access layer for the
 * `user_notification_preferences` table.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type {
  NotificationCategory,
  NotificationPreferenceInput,
  NotificationPreferenceRow,
} from '../types';

export class NotificationPreferenceRepository {
  constructor(private db: Db) {}

  async findByUser(userId: number): Promise<NotificationPreferenceRow[]> {
    return this.db.query<NotificationPreferenceRow[]>(
      'SELECT * FROM user_notification_preferences WHERE user_id = ?',
      [userId],
    );
  }

  /** Explicitly set a preference (rows default to enabled when absent). */
  async set(data: NotificationPreferenceInput): Promise<void> {
    const { user_id, category, enabled } = data;
    await this.db.query<ResultSetHeader>(
      `INSERT INTO user_notification_preferences (user_id, category, enabled)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
      [user_id, category, enabled ? 1 : 0],
    );
  }

  /** Which of the given user ids have suppressed this category. */
  async findDisabledUserIds(
    category: NotificationCategory,
    userIds: number[],
  ): Promise<number[]> {
    const ids = userIds.filter((id) => Number.isFinite(Number(id))).map(Number);
    if (ids.length === 0) return [];
    const rows = await this.db.query<Array<{ user_id: number }>>(
      `SELECT user_id FROM user_notification_preferences
       WHERE category = ? AND enabled = 0 AND user_id IN (?)`,
      [category, ids],
    );
    return (rows as Array<{ user_id: number }>).map((r) => Number(r.user_id));
  }

  async isEnabled(userId: number, category: NotificationCategory): Promise<boolean> {
    const [row] = await this.db.query<Array<{ enabled: number }>>(
      `SELECT enabled FROM user_notification_preferences
       WHERE user_id = ? AND category = ?`,
      [userId, category],
    );
    if (!row) return true; // absent = default enabled
    return row.enabled === 1;
  }
}
