/**
 * RolePermissionRepository — data-access layer for the `role_permissions`
 * table: per-company overrides of the discretionary permission catalog
 * (utils/permissions.ts). An absent row means "use the baseline role
 * hierarchy"; a row pins `allowed` on/off for (company, role, capability).
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { RolePermissionRow } from '../types';

export class RolePermissionRepository {
  constructor(private db: Db) {}

  /** Every override stored for a company (for the matrix view). */
  async findByCompany(companyId: number): Promise<RolePermissionRow[]> {
    return this.db.query<RolePermissionRow[]>(
      `SELECT company_id, role, permission_key, allowed, updated_by, updated_at
       FROM role_permissions WHERE company_id = ?`,
      [companyId],
    );
  }

  /** The stored override for one (company, role, capability), if any. */
  async findByKey(
    companyId: number,
    role: string,
    permissionKey: string,
  ): Promise<RolePermissionRow | null> {
    const rows = await this.db.query<RolePermissionRow[]>(
      `SELECT company_id, role, permission_key, allowed, updated_by, updated_at
       FROM role_permissions
       WHERE company_id = ? AND role = ? AND permission_key = ? LIMIT 1`,
      [companyId, role, permissionKey],
    );
    return rows[0] || null;
  }

  /** Set (or refresh) an override. */
  async upsert(
    companyId: number,
    role: string,
    permissionKey: string,
    allowed: boolean,
    updatedBy: number | null,
  ): Promise<void> {
    await this.db.query<ResultSetHeader>(
      `INSERT INTO role_permissions (company_id, role, permission_key, allowed, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE allowed = VALUES(allowed), updated_by = VALUES(updated_by)`,
      [companyId, role, permissionKey, allowed ? 1 : 0, updatedBy],
    );
  }

  /** Remove an override, falling back to the baseline hierarchy. */
  async remove(companyId: number, role: string, permissionKey: string): Promise<void> {
    await this.db.query<ResultSetHeader>(
      'DELETE FROM role_permissions WHERE company_id = ? AND role = ? AND permission_key = ?',
      [companyId, role, permissionKey],
    );
  }
}
