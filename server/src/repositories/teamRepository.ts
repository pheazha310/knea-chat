/**
 * TeamRepository — data-access layer for the `teams` table.
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { CreateTeamData, TeamFilters, TeamRow } from '../types';

export class TeamRepository {
  constructor(private db: Db) {}

  async findAll(filters: TeamFilters): Promise<TeamRow[]> {
    const { companyId, page = 1, limit = 20, search = '', requesterId } = filters;
    let sql = `SELECT t.*, u.first_name as manager_first_name, u.last_name as manager_last_name,
               (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count,
               (SELECT role FROM team_members WHERE team_id = t.id AND user_id = ?) as user_role
               FROM teams t
               LEFT JOIN users u ON t.created_by = u.id
               WHERE t.company_id = ?`;
    const params: unknown[] = [requesterId ?? null, companyId];

    if (search) {
      sql += ' AND t.name LIKE ?';
      params.push(`%${search}%`);
    }

    sql += ' ORDER BY t.name ASC LIMIT ? OFFSET ?';
    params.push(parseInt(String(limit)), (parseInt(String(page)) - 1) * parseInt(String(limit)));

    return this.db.query<TeamRow[]>(sql, params);
  }

  async findById(id: number): Promise<TeamRow | null> {
    const teams = await this.db.query<TeamRow[]>('SELECT * FROM teams WHERE id = ?', [id]);
    return teams[0] || null;
  }

  async create(data: CreateTeamData): Promise<number> {
    const { company_id, name, description, created_by, department_id } = data;
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO teams (company_id, name, description, created_by, department_id) VALUES (?, ?, ?, ?, ?)',
      [company_id, name, description || null, created_by, department_id || null],
    );
    return result.insertId;
  }

  async update(id: number, data: Record<string, unknown>): Promise<boolean> {
    const allowed = ['name', 'description'];
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
    const result = await this.db.query<ResultSetHeader>(`UPDATE teams SET ${updates.join(', ')} WHERE id = ?`, params);
    return result.affectedRows > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('DELETE FROM teams WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  async countByCompany(companyId: number): Promise<number> {
    const [row] = await this.db.query<Array<{ count: number }>>('SELECT COUNT(*) as count FROM teams WHERE company_id = ?', [companyId]);
    return parseInt(String(row.count));
  }

  /** Teams with a given name inside a company (team conversations are matched by name). */
  async findByName(name: string, companyId: number): Promise<TeamRow[]> {
    return this.db.query<TeamRow[]>(
      'SELECT * FROM teams WHERE name = ? AND company_id = ?',
      [name, companyId],
    );
  }
}
