/**
 * Permission catalog — the discretionary capabilities a Company Admin can
 * restrict per role, on top of the fixed role hierarchy.
 *
 * The baseline model stays untouched: `super_admin > admin > manager >
 * employee`, enforced everywhere via `roles.ts`. This catalog adds a small
 * set of *delegable* capabilities whose baseline is already `manager` —
 * meaning a Company Admin may toggle them off for the manager role in their
 * company (admins and super admins always keep them, and the permission is
 * stored in `role_permissions`). When no override exists the baseline in
 * this file is the answer, so a fresh database behaves exactly like today.
 */
import type { Role } from '../types';
import { ROLES, isAtLeast } from './roles';

export type PermissionKey =
  | 'create_teams'
  | 'manage_teams'
  | 'manage_team_members'
  | 'manage_channels'
  | 'publish_announcements';

export interface PermissionDef {
  key: PermissionKey;
  label: string;
  group: 'Organization' | 'Teams' | 'Channels' | 'Communication';
  description: string;
  /** Baseline: the lowest role that may perform the action today. */
  baselineRole: Role;
  /** Company roles this capability may be restricted for (toggled). */
  restrictableRoles: Role[];
}

export const PERMISSION_CATALOG: PermissionDef[] = [
  {
    key: 'create_teams',
    label: 'Create teams',
    group: 'Teams',
    description: 'Create new teams in the workspace.',
    baselineRole: ROLES.MANAGER,
    restrictableRoles: [ROLES.MANAGER],
  },
  {
    key: 'manage_teams',
    label: 'Manage teams',
    group: 'Teams',
    description: 'Edit or delete teams, including teams you are assigned to.',
    baselineRole: ROLES.MANAGER,
    restrictableRoles: [ROLES.MANAGER],
  },
  {
    key: 'manage_team_members',
    label: 'Manage team members',
    group: 'Teams',
    description: 'Add or remove members of teams you manage.',
    baselineRole: ROLES.MANAGER,
    restrictableRoles: [ROLES.MANAGER],
  },
  {
    key: 'manage_channels',
    label: 'Manage channels',
    group: 'Channels',
    description: 'Edit or delete channels inside teams you manage.',
    baselineRole: ROLES.MANAGER,
    restrictableRoles: [ROLES.MANAGER],
  },
  {
    key: 'publish_announcements',
    label: 'Publish announcements',
    group: 'Communication',
    description: 'Create, edit and publish announcements to the workspace.',
    baselineRole: ROLES.MANAGER,
    restrictableRoles: [ROLES.MANAGER],
  },
];

export const PERMISSION_MAP: Record<PermissionKey, PermissionDef> = Object.fromEntries(
  PERMISSION_CATALOG.map((def) => [def.key, def]),
) as Record<PermissionKey, PermissionDef>;

export const isPermissionKey = (value: unknown): value is PermissionKey =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PERMISSION_MAP, value);

export const assertPermissionKey = (value: unknown): PermissionKey => {
  if (!isPermissionKey(value)) {
    throw new Error(
      `Unknown permission "${String(value)}". Valid permissions: ${PERMISSION_CATALOG.map((p) => p.key).join(', ')}`,
    );
  }
  return value;
};

/**
 * Baseline answer (no company override): whether `role` may perform the
 * capability. Admins & super admins always can; other roles inherit from the
 * catalog baseline (or, for non-restrictable roles, fall back to the plain
 * hierarchy test).
 */
export const baselineAllows = (role: string, permissionKey: PermissionKey): boolean => {
  if (role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN) return true;
  const def = PERMISSION_MAP[permissionKey];
  if (!def) return false;
  if (!def.restrictableRoles.includes(role as Role)) {
    return isAtLeast(role, def.baselineRole);
  }
  return isAtLeast(role, def.baselineRole);
};
