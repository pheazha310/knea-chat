/**
 * CompanyRepository — data-access layer for the `companies` table.
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { CompanyFilters, CompanyRow, CreateCompanyData, UserRow } from '../types';

export class CompanyRepository {
  constructor(private db: Db) {}

  /**
   * List companies with aggregate stats for the platform admin console.
   * Only super admins call this (enforced at the route layer).
   */
  async findAll(filters: CompanyFilters = {}): Promise<CompanyRow[]> {
    const { search = '' } = filters;
    let sql = `
      SELECT c.id, c.name, c.domain, c.logo, c.created_at, c.updated_at,
             c.plan_key, c.plan_status, c.plan_expires_at, c.billing_email,
             (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS user_count,
             (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.is_active = 1) AS active_user_count,
             (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.role = 'admin') AS admin_count,
             (SELECT COUNT(*) FROM teams t WHERE t.company_id = c.id) AS team_count,
             (SELECT COUNT(*) FROM channels ch WHERE ch.company_id = c.id) AS channel_count
      FROM companies c`;
    const params: unknown[] = [];

    if (search) {
      sql += ' WHERE c.name LIKE ? OR c.domain LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY c.created_at DESC';
    return this.db.query<CompanyRow[]>(sql, params);
  }

  async findById(id: number): Promise<CompanyRow | null> {
    const companies = await this.db.query<CompanyRow[]>(
      `SELECT c.*,
              (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS user_count,
              (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.is_active = 1) AS active_user_count,
              (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.role = 'admin') AS admin_count,
              (SELECT COUNT(*) FROM teams t WHERE t.company_id = c.id) AS team_count,
              (SELECT COUNT(*) FROM channels ch WHERE ch.company_id = c.id) AS channel_count
       FROM companies c WHERE c.id = ?`,
      [id],
    );
    return companies[0] || null;
  }

  async findByDomain(domain: string): Promise<CompanyRow | null> {
    const companies = await this.db.query<CompanyRow[]>('SELECT * FROM companies WHERE domain = ?', [domain]);
    return companies[0] || null;
  }

  async create(data: CreateCompanyData): Promise<number> {
    const { name, domain, logo } = data;
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO companies (name, domain, logo) VALUES (?, ?, ?)',
      [name, domain || null, logo || null],
    );
    return result.insertId;
  }

  async update(id: number, data: Record<string, unknown>): Promise<boolean> {
    // `name/domain/logo` are branding; the rest are the subscription / plan
    // fields managed by the Super Admin (Administration module).
    const allowed = [
      'name', 'domain', 'logo',
      'plan_key', 'plan_status', 'plan_expires_at', 'billing_email',
    ];
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
    const result = await this.db.query<ResultSetHeader>(`UPDATE companies SET ${updates.join(', ')} WHERE id = ?`, params);
    return result.affectedRows > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('DELETE FROM companies WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  /** Count dependent rows so the service can refuse to delete non-empty orgs. */
  async countDependents(id: number): Promise<{ users: number; teams: number; channels: number }> {
    const [row] = await this.db.query<Array<{ users: number; teams: number; channels: number }>>(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE company_id = ?) AS users,
         (SELECT COUNT(*) FROM teams WHERE company_id = ?) AS teams,
         (SELECT COUNT(*) FROM channels WHERE company_id = ?) AS channels`,
      [id, id, id],
    );
    return {
      users: parseInt(String(row.users), 10),
      teams: parseInt(String(row.teams), 10),
      channels: parseInt(String(row.channels), 10),
    };
  }

  async findUsers(companyId: number, role = ''): Promise<UserRow[]> {
    let sql = `SELECT id, company_id, department_id, first_name, last_name, email, role, job_title,
                      profile_picture, status, is_active, last_seen_at, created_at
               FROM users WHERE company_id = ?`;
    const params: unknown[] = [companyId];
    if (role) {
      sql += ' AND role = ?';
      params.push(role);
    }
    sql += ' ORDER BY first_name ASC';
    return this.db.query<UserRow[]>(sql, params);
  }
}
