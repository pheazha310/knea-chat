/**
 * AnnouncementRepository — data-access layer for the `announcements` table.
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { AnnouncementRow } from '../types';

export class AnnouncementRepository {
  constructor(private db: Db) {}

  async findAll(companyId: number): Promise<AnnouncementRow[]> {
    return this.db.query<AnnouncementRow[]>(
      `SELECT a.*, u.first_name as creator_first_name, u.last_name as creator_last_name
       FROM announcements a
       LEFT JOIN users u ON a.created_by = u.id
       WHERE a.company_id = ?
       ORDER BY a.created_at DESC`,
      [companyId],
    );
  }

  async findById(id: number): Promise<AnnouncementRow | null> {
    const announcements = await this.db.query<AnnouncementRow[]>(
      `SELECT a.*, u.first_name as creator_first_name, u.last_name as creator_last_name
       FROM announcements a
       LEFT JOIN users u ON a.created_by = u.id
       WHERE a.id = ?`,
      [id],
    );
    return announcements[0] || null;
  }

  async create(data: {
    company_id: number;
    title: string;
    content: string;
    created_by: number;
  }): Promise<number> {
    const { company_id, title, content, created_by } = data;
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO announcements (company_id, title, content, created_by) VALUES (?, ?, ?, ?)',
      [company_id, title, content, created_by],
    );
    return result.insertId;
  }

  async update(id: number, data: Record<string, unknown>): Promise<boolean> {
    const allowed = ['title', 'content'];
    const updates: string[] = [];
    const params: unknown[] = [];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key]);
      }
    }

    if (!updates.length) return false;

    params.push(id);
    const result = await this.db.query<ResultSetHeader>(
      `UPDATE announcements SET ${updates.join(', ')} WHERE id = ?`,
      params,
    );
    return result.affectedRows > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'DELETE FROM announcements WHERE id = ?',
      [id],
    );
    return result.affectedRows > 0;
  }
}
