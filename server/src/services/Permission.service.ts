/**
 * PermissionService — discretionary permission management (Company Admin
 * console → "Manage permissions").
 *
 * The SRS role matrix (utils/roles.ts) stays the baseline: every capability
 * in the catalog (utils/permissions.ts) defaults to what the hierarchy
 * already allows. A Company Admin may pin a capability OFF for the manager
 * role inside their company; those pins live in `role_permissions`. Admins
 * and Super Admins always keep every capability.
 */
import type { RolePermissionRepository } from '../repositories/rolePermissionRepository';
import { ROLES } from '../utils/roles';
import {
  PERMISSION_CATALOG,
  assertPermissionKey,
  baselineAllows,
  type PermissionKey,
} from '../utils/permissions';
import type { Role } from '../types';

/** What enforcement points need: an async per-company capability answer. */
export interface PermissionPolicy {
  allows(companyId: number, role: string, permissionKey: PermissionKey): Promise<boolean>;
}

export interface PermissionMatrixRow {
  role: string;
  permission_key: PermissionKey;
  allowed: boolean;
  /** True when the company pinned an explicit value for this cell. */
  is_override: boolean;
  /** Whether this cell may be toggled by the Company Admin. */
  restrictable: boolean;
}

export class PermissionService implements PermissionPolicy {
  constructor(private rolePermissionRepository: RolePermissionRepository) {}

  /**
   * Effective answer for (company, role, capability). Route/service
   * enforcement points call this instead of assuming the baseline.
   */
  async allows(companyId: number, role: string, permissionKey: PermissionKey): Promise<boolean> {
    // Platform + company administrators are never restricted.
    if (role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN) return true;

    const override = await this.rolePermissionRepository.findByKey(
      companyId,
      role,
      permissionKey,
    );
    if (override) return override.allowed === 1;
    return baselineAllows(role, permissionKey);
  }

  /** Throws unless the actor may perform the capability. */
  async assertAllowed(
    companyId: number,
    role: string,
    permissionKey: PermissionKey,
  ): Promise<void> {
    if (!(await this.allows(companyId, role, permissionKey))) {
      throw new Error('You do not have permission to perform this action');
    }
  }

  /** The full matrix (baseline merged with stored overrides) for a company. */
  async getMatrix(companyId: number): Promise<PermissionMatrixRow[]> {
    const overrides = await this.rolePermissionRepository.findByCompany(companyId);
    const overrideMap = new Map<string, number>();
    for (const row of overrides) {
      overrideMap.set(`${row.role}:${row.permission_key}`, row.allowed);
    }

    const roles: Role[] = [ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE];
    const matrix: PermissionMatrixRow[] = [];
    for (const def of PERMISSION_CATALOG) {
      for (const role of roles) {
        const stored = overrideMap.get(`${role}:${def.key}`);
        const restrictable =
          role !== ROLES.ADMIN && def.restrictableRoles.includes(role);
        const allowed =
          role === ROLES.ADMIN
            ? true
            : stored !== undefined
              ? stored === 1
              : baselineAllows(role, def.key);
        matrix.push({
          role,
          permission_key: def.key,
          allowed,
          is_override: stored !== undefined,
          restrictable,
        });
      }
    }
    return matrix;
  }

  /** The permission catalog (labels/groups/descriptions) for the matrix UI. */
  getCatalog() {
    return PERMISSION_CATALOG;
  }

  /** Pin a capability on/off for a company role (admin+ enforced at routes). */
  async setOverride(
    companyId: number,
    role: string,
    permissionKey: PermissionKey,
    allowed: boolean,
    actorId: number,
  ): Promise<PermissionMatrixRow> {
    const key = assertPermissionKey(permissionKey);
    const def = PERMISSION_CATALOG.find((d) => d.key === key);
    if (role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN) {
      throw new Error('Administrator permissions cannot be restricted');
    }
    if (!def || !def.restrictableRoles.includes(role as Role)) {
      throw new Error(`Permission "${key}" cannot be changed for the ${role} role`);
    }
    await this.rolePermissionRepository.upsert(companyId, role, key, allowed, actorId);
    return {
      role,
      permission_key: key,
      allowed,
      is_override: true,
      restrictable: true,
    };
  }

  /** Remove an override → the cell falls back to the baseline hierarchy. */
  async resetOverride(
    companyId: number,
    role: string,
    permissionKey: PermissionKey,
  ): Promise<void> {
    await this.rolePermissionRepository.remove(companyId, role, permissionKey);
  }
}
