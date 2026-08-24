/**
 * TeamMemberRepository — data-access layer for the `team_members` table.
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { TeamMemberRow } from '../types';

export class TeamMemberRepository {
  constructor(private db: Db) {}

  async add(teamId: number, userId: number, role = 'member'): Promise<number> {
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)',
      [teamId, userId, role],
    );
    return result.insertId;
  }

  async remove(teamId: number, userId: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [teamId, userId]);
    return result.affectedRows > 0;
  }

  async findMembers(teamId: number): Promise<TeamMemberRow[]> {
    return this.db.query<TeamMemberRow[]>(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.job_title, u.status, u.profile_picture, tm.role as team_role, tm.joined_at
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = ?
       ORDER BY tm.joined_at ASC`,
      [teamId],
    );
  }

  async isMember(teamId: number, userId: number): Promise<boolean> {
    const [row] = await this.db.query<Array<{ id: number }>>('SELECT id FROM team_members WHERE team_id = ? AND user_id = ?', [teamId, userId]);
    return !!row;
  }

  async getRole(teamId: number, userId: number): Promise<string | null> {
    const [row] = await this.db.query<Array<{ role: string }>>('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?', [teamId, userId]);
    return row ? row.role : null;
  }

  async countMembers(teamId: number): Promise<number> {
    const [row] = await this.db.query<Array<{ count: number }>>('SELECT COUNT(*) as count FROM team_members WHERE team_id = ?', [teamId]);
    return parseInt(String(row.count));
  }

  async findMemberIds(teamId: number): Promise<number[]> {
    const rows = await this.db.query<Array<{ user_id: number }>>(
      'SELECT user_id FROM team_members WHERE team_id = ?',
      [teamId],
    );
    return rows.map((row) => row.user_id);
  }

  async updateRole(teamId: number, userId: number, role: string): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?', [role, teamId, userId]);
    return result.affectedRows > 0;
  }
}
