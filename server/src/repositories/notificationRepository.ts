/**
 * NotificationRepository — data-access layer for the `notifications` table.
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { CreateNotificationData, NotificationFilters, NotificationRow } from '../types';

export class NotificationRepository {
  constructor(private db: Db) {}

  async findAll(filters: NotificationFilters): Promise<NotificationRow[]> {
    const { userId, page = 1, limit = 20, is_read = '' } = filters;
    let sql = 'SELECT * FROM notifications WHERE user_id = ?';
    const params: unknown[] = [userId];

    if (is_read !== '') {
      sql += ' AND is_read = ?';
      params.push(parseInt(is_read));
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(String(limit)), (parseInt(String(page)) - 1) * parseInt(String(limit)));

    return this.db.query<NotificationRow[]>(sql, params);
  }

  async findById(id: number): Promise<NotificationRow | null> {
    const notifications = await this.db.query<NotificationRow[]>('SELECT * FROM notifications WHERE id = ?', [id]);
    return notifications[0] || null;
  }

  async create(data: CreateNotificationData): Promise<number> {
    const { user_id, actor_id, type, title, message, data: extraData } = data;
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO notifications (user_id, actor_id, type, title, message, data) VALUES (?, ?, ?, ?, ?, ?)',
      [user_id, actor_id || null, type, title, message || null, extraData ? JSON.stringify(extraData) : null],
    );
    return result.insertId;
  }

  async markAsRead(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('UPDATE notifications SET is_read = 1 WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  async markAllAsRead(userId: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [userId]);
    return result.affectedRows > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('DELETE FROM notifications WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  async getUnreadCount(userId: number): Promise<number> {
    const [row] = await this.db.query<Array<{ count: number }>>('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [userId]);
    return parseInt(String(row.count));
  }
}
