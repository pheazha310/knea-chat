/**
 * AuditLogRepository — data-access layer for the `audit_logs` table.
 * Contains SQL only; business logic lives in the services.
 *
 * Rows with `company_id` NULL are platform-scope actions (Super Admin
 * console); every other row belongs to exactly one company's trail.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { AuditLogFilters, AuditLogRow, CreateAuditLogData } from '../types';

const SELECT = `
  SELECT al.*,
         u.first_name AS actor_first_name,
         u.last_name AS actor_last_name,
         u.email AS actor_email
  FROM audit_logs al
  LEFT JOIN users u ON u.id = al.actor_user_id`;

export class AuditLogRepository {
  constructor(private db: Db) {}

  async create(data: CreateAuditLogData): Promise<number> {
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO audit_logs
         (company_id, actor_user_id, actor_role, action, entity_type, entity_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.company_id ?? null,
        data.actor_user_id,
        data.actor_role,
        data.action,
        data.entity_type,
        data.entity_id ?? null,
        data.details ? JSON.stringify(data.details) : null,
        data.ip_address ?? null,
      ],
    );
    return result.insertId;
  }

  /** Where-clause + params shared by the scoped list queries. */
  private buildFilter(filters: AuditLogFilters, scopeSql: string): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    let sql = `${SELECT} WHERE ${scopeSql}`;

    if (filters.action) {
      sql += ' AND al.action = ?';
      params.push(filters.action);
    }
    if (filters.entity_type) {
      sql += ' AND al.entity_type = ?';
      params.push(filters.entity_type);
    }
    if (filters.entity_id !== undefined && filters.entity_id !== null) {
      sql += ' AND al.entity_id = ?';
      params.push(filters.entity_id);
    }
    if (filters.actor_user_id !== undefined && filters.actor_user_id !== null) {
      sql += ' AND al.actor_user_id = ?';
      params.push(filters.actor_user_id);
    }

    sql += ' ORDER BY al.created_at DESC, al.id DESC LIMIT ?';
    params.push(Math.min(Math.max(filters.limit || 100, 1), 500));
    return { sql, params };
  }

  /** A company's audit trail (Company Admin console). */
  async findByCompany(companyId: number, filters: AuditLogFilters = {}): Promise<AuditLogRow[]> {
    const { sql, params } = this.buildFilter(filters, 'al.company_id = ?');
    return this.db.query<AuditLogRow[]>(sql, [companyId, ...params]);
  }

  /** The platform-wide trail — every company + platform-scope action (Super Admin). */
  async findByPlatform(filters: AuditLogFilters = {}): Promise<AuditLogRow[]> {
    const { sql, params } = this.buildFilter(filters, '1 = 1');
    return this.db.query<AuditLogRow[]>(sql, params);
  }

  /** Platform-scope actions only (no company). */
  async findPlatformOnly(filters: AuditLogFilters = {}): Promise<AuditLogRow[]> {
    const { sql, params } = this.buildFilter(filters, 'al.company_id IS NULL');
    return this.db.query<AuditLogRow[]>(sql, params);
  }
}
