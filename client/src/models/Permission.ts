// Permission domain model — MVVM Model layer.
// The discretionary permission catalog + the per-company matrix managed by
// the Company Admin console (/api/company-settings/permissions).
import api from '../services/api';

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
  baselineRole: string;
  restrictableRoles: string[];
}

export interface PermissionMatrixRow {
  role: 'admin' | 'manager' | 'employee';
  permission_key: PermissionKey;
  allowed: boolean;
  is_override: boolean;
  restrictable: boolean;
}

export const PermissionModel = {
  get: () =>
    api.get<{
      success: boolean;
      data: { matrix: PermissionMatrixRow[]; catalog: PermissionDef[] };
    }>('/company-settings/permissions'),
  /** allowed true/false pins; null/'default' resets to the baseline. */
  update: (role: string, permission_key: PermissionKey, allowed: boolean | 'default') =>
    api.patch<{
      success: boolean;
      data: { matrix: PermissionMatrixRow[] };
    }>('/company-settings/permissions', { role, permission_key, allowed }),
};
