/**
 * UserRepository — data-access layer for the `users` table.
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { CreateUserData, UpdateUserData, UserFilters, UserRow } from '../types';

export class UserRepository {
  constructor(private db: Db) {}

  async findAll(filters: UserFilters): Promise<UserRow[]> {
    const { companyId, page = 1, limit = 20, search = '', role = '', department_id = '' } = filters;
    let sql = 'SELECT id, company_id, department_id, manager_id, first_name, last_name, email, role, job_title, profile_picture, status, is_active, last_seen_at, created_at, updated_at FROM users WHERE company_id = ?';
    const params: unknown[] = [companyId];

    if (search) {
      sql += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (role) {
      sql += ' AND role = ?';
      params.push(role);
    }

    if (department_id) {
      sql += ' AND department_id = ?';
      params.push(parseInt(department_id));
    }

    sql += ' ORDER BY first_name ASC LIMIT ? OFFSET ?';
    params.push(parseInt(String(limit)), (parseInt(String(page)) - 1) * parseInt(String(limit)));

    return this.db.query<UserRow[]>(sql, params);
  }

  async findById(id: number): Promise<UserRow | null> {
    const users = await this.db.query<UserRow[]>('SELECT id, company_id, department_id, manager_id, first_name, last_name, email, role, job_title, profile_picture, status, is_active, last_seen_at, created_at, updated_at FROM users WHERE id = ?', [id]);
    return users[0] || null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const users = await this.db.query<UserRow[]>('SELECT * FROM users WHERE email = ?', [email]);
    return users[0] || null;
  }

  async findByIds(ids: number[]): Promise<UserRow[]> {
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.query<UserRow[]>(`SELECT id, company_id, first_name, last_name, email, role, job_title, profile_picture, status FROM users WHERE id IN (${placeholders})`, ids);
  }

  async create(data: CreateUserData): Promise<number> {
    const { company_id, department_id, manager_id, first_name, last_name, email, password, role, job_title } = data;
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO users (company_id, department_id, manager_id, first_name, last_name, email, password, role, job_title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [company_id, department_id, manager_id, first_name, last_name, email, password, role || 'employee', job_title || null],
    );
    return result.insertId;
  }

  async update(id: number, data: UpdateUserData): Promise<boolean | null> {
    const allowed = ['first_name', 'last_name', 'email', 'job_title', 'profile_picture', 'status', 'department_id', 'manager_id', 'role', 'is_active'];
    const updates: string[] = [];
    const params: unknown[] = [];

    for (const key of allowed) {
      if (data[key as keyof UpdateUserData] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key as keyof UpdateUserData]);
      }
    }

    if (!updates.length) return null;

    params.push(id);
    const result = await this.db.query<ResultSetHeader>(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    return result.affectedRows > 0;
  }

  async updatePassword(id: number, password: string): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('UPDATE users SET password = ? WHERE id = ?', [password, id]);
    return result.affectedRows > 0;
  }

  async softDelete(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('UPDATE users SET is_active = 0 WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  async updateStatus(id: number, status: string): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('UPDATE users SET status = ?, last_seen_at = NOW() WHERE id = ?', [status, id]);
    return result.affectedRows > 0;
  }

  async countByCompany(companyId: number): Promise<number> {
    const [row] = await this.db.query<Array<{ count: number }>>('SELECT COUNT(*) as count FROM users WHERE company_id = ?', [companyId]);
    return parseInt(String(row.count));
  }

  /** Ids of every user in a company (used for company-wide notifications). */
  async findCompanyUserIds(companyId: number): Promise<number[]> {
    const rows = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM users WHERE company_id = ?',
      [companyId],
    );
    return rows.map((row) => row.id);
  }

  /**
   * Ids of every non-external user (active internal accounts). Used to
   * auto-join omni-channel inbox conversations to all agents.
   */
  async findInternalUserIds(): Promise<number[]> {
    const rows = await this.db.query<Array<{ id: number }>>(
      "SELECT id FROM users WHERE role <> 'external' AND is_active = 1",
    );
    return rows.map((row) => row.id);
  }

  async search(companyId: number, search: string, limit = 20): Promise<UserRow[]> {
    return this.db.query<UserRow[]>(
      'SELECT id, first_name, last_name, email, role, job_title, profile_picture, status FROM users WHERE company_id = ? AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?) AND is_active = 1 LIMIT ?',
      [companyId, `%${search}%`, `%${search}%`, `%${search}%`, limit],
    );
  }
}
