/**
 * ChannelMemberRepository — data-access layer for the `channel_members` table.
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { ChannelMemberRow } from '../types';

export class ChannelMemberRepository {
  constructor(private db: Db) {}

  async add(channelId: number, userId: number, role = 'member'): Promise<number> {
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO channel_members (channel_id, user_id, role) VALUES (?, ?, ?)',
      [channelId, userId, role],
    );
    return result.insertId;
  }

  async remove(channelId: number, userId: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?', [channelId, userId]);
    return result.affectedRows > 0;
  }

  async findMembers(channelId: number): Promise<ChannelMemberRow[]> {
    return this.db.query<ChannelMemberRow[]>(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.job_title, u.status, u.profile_picture, cm.role as channel_role, cm.joined_at
       FROM channel_members cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.channel_id = ?
       ORDER BY cm.joined_at ASC`,
      [channelId],
    );
  }

  async findMemberIds(channelId: number): Promise<number[]> {
    const rows = await this.db.query<Array<{ user_id: number }>>(
      'SELECT user_id FROM channel_members WHERE channel_id = ?',
      [channelId],
    );
    return rows.map((row) => row.user_id);
  }

  async isMember(channelId: number, userId: number): Promise<boolean> {
    const [row] = await this.db.query<Array<{ id: number }>>('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?', [channelId, userId]);
    return !!row;
  }

  async getRole(channelId: number, userId: number): Promise<string | null> {
    const [row] = await this.db.query<Array<{ role: string }>>('SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?', [channelId, userId]);
    return row ? row.role : null;
  }

  async countMembers(channelId: number): Promise<number> {
    const [row] = await this.db.query<Array<{ count: number }>>('SELECT COUNT(*) as count FROM channel_members WHERE channel_id = ?', [channelId]);
    return parseInt(String(row.count));
  }
}
