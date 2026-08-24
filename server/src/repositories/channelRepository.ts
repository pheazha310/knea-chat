/**
 * ChannelRepository — data-access layer for the `channels` table.
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { ChannelFilters, ChannelRow, CreateChannelData } from '../types';

export class ChannelRepository {
  constructor(private db: Db) {}

  async findAll(filters: ChannelFilters): Promise<ChannelRow[]> {
    const { companyId, teamId, page = 1, limit = 20, search = '' } = filters;
    let sql = `SELECT c.*, u.first_name as creator_first_name, u.last_name as creator_last_name,
               (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) as member_count
               FROM channels c
               LEFT JOIN users u ON c.created_by = u.id
               WHERE c.company_id = ?`;
    const params: unknown[] = [companyId];

    if (teamId) {
      sql += ' AND c.team_id = ?';
      params.push(teamId);
    }

    if (search) {
      sql += ' AND c.name LIKE ?';
      params.push(`%${search}%`);
    }

    sql += ' ORDER BY c.name ASC LIMIT ? OFFSET ?';
    params.push(parseInt(String(limit)), (parseInt(String(page)) - 1) * parseInt(String(limit)));

    return this.db.query<ChannelRow[]>(sql, params);
  }

  async findById(id: number): Promise<ChannelRow | null> {
    const channels = await this.db.query<ChannelRow[]>('SELECT * FROM channels WHERE id = ?', [id]);
    return channels[0] || null;
  }

  async create(data: CreateChannelData): Promise<number> {
    const { company_id, name, description, created_by, type, team_id } = data;
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO channels (company_id, name, description, created_by, type, team_id) VALUES (?, ?, ?, ?, ?, ?)',
      [company_id, name, description || null, created_by, type || 'public', team_id || null],
    );
    return result.insertId;
  }

  async update(id: number, data: Record<string, unknown>): Promise<boolean> {
    const allowed = ['name', 'description', 'type', 'is_archived'];
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
    const result = await this.db.query<ResultSetHeader>(`UPDATE channels SET ${updates.join(', ')} WHERE id = ?`, params);
    return result.affectedRows > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('DELETE FROM channels WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  /** Channels with a given name inside a company (channel conversations are matched by name). */
  async findByName(name: string, companyId: number): Promise<ChannelRow[]> {
    return this.db.query<ChannelRow[]>(
      'SELECT * FROM channels WHERE name = ? AND company_id = ?',
      [name, companyId],
    );
  }

  async findByUser(userId: number, companyId: number): Promise<ChannelRow[]> {
    return this.db.query<ChannelRow[]>(
      `SELECT c.*, cm.role as user_role, u.first_name as creator_first_name, u.last_name as creator_last_name
       FROM channels c
       JOIN channel_members cm ON c.id = cm.channel_id
       LEFT JOIN users u ON c.created_by = u.id
       WHERE cm.user_id = ? AND c.company_id = ?
       ORDER BY c.name ASC`,
      [userId, companyId],
    );
  }
}
