// Role display helpers — friendly names for the platform role matrix:
//   super_admin  → Super Admin     (controls the entire platform)
//   admin        → Company Admin   (manages a company/workspace)
//   manager      → Manager         (manages assigned teams)
//   employee     → Employee        (regular workplace user)
import type { Role } from '../models/User';

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Company Admin',
  manager: 'Manager',
  employee: 'Employee',
};

/** Friendly label for a role key; falls back to the raw key when unknown. */
export const roleLabel = (role?: string | null): string =>
  role && role in ROLE_LABELS ? ROLE_LABELS[role as Role] : role || '';
