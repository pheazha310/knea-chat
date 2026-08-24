/**
 * Role-based access control (RBAC) constants and helpers.
 *
 * The permission model is hierarchical (SRS role matrix):
 *   super_admin > admin (company) > manager > employee
 * Higher roles inherit every permission of the roles below them.
 */
import type { Role } from '../types';

export const ROLES: Record<string, Role> = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
};

const ROLE_RANK: Record<string, number> = {
  [ROLES.SUPER_ADMIN]: 4,
  [ROLES.ADMIN]: 3,
  [ROLES.MANAGER]: 2,
  [ROLES.EMPLOYEE]: 1,
};

/** All roles that can be assigned within a company (excludes super_admin). */
export const COMPANY_ROLES: Role[] = [ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE];

/** True when `userRole` is at or above `requiredRole` in the hierarchy. */
export const isAtLeast = (userRole: string, requiredRole: string): boolean => {
  const userRank = ROLE_RANK[userRole] || 0;
  const requiredRank = ROLE_RANK[requiredRole] || 0;
  return userRank >= requiredRank;
};

/** Whether `userRole` may assign `targetRole` to another user. */
export const canAssignRole = (userRole: string, targetRole: string): boolean => {
  // Only a super admin may create or promote another super admin.
  if (targetRole === ROLES.SUPER_ADMIN) {
    return userRole === ROLES.SUPER_ADMIN;
  }
  // A company admin manages employees/roles within their company.
  return isAtLeast(userRole, ROLES.ADMIN);
};
