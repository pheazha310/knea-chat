/**
 * Administration types — audit logs, company settings, role permission
 * overrides, subscription plans, and platform metrics (module 10 of the
 * product spec: Company Admin + Super Admin administration).
 */

export interface AuditLogRow {
  id: number;
  company_id: number | null;
  actor_user_id: number;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: Date | string;
  // Joined actor identity (queries LEFT JOIN users)
  actor_first_name?: string | null;
  actor_last_name?: string | null;
  actor_email?: string | null;
}

export interface CreateAuditLogData {
  company_id?: number | null;
  actor_user_id: number;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id?: number | null;
  details?: Record<string, unknown> | null;
  ip_address?: string | null;
}

export interface AuditLogFilters {
  action?: string;
  entity_type?: string;
  entity_id?: number | null;
  actor_user_id?: number | null;
  limit?: number;
}

export interface CompanySettingRow {
  company_id: number;
  setting_key: string;
  setting_value: string;
  updated_at: Date | string;
}

export interface RolePermissionRow {
  company_id: number;
  role: string;
  permission_key: string;
  allowed: number;
  updated_by: number | null;
  updated_at: Date | string;
}

export interface PlatformMetrics {
  totals: {
    companies: number;
    users: number;
    active_users: number;
    teams: number;
    channels: number;
    departments: number;
    messages: number;
    conversations: number;
    shared_files: number;
    tasks: number;
    meetings: number;
    announcements: number;
    active_sessions: number;
  };
  online_users: number;
  today: {
    messages: number;
    users_joined: number;
    companies_created: number;
  };
  storage: {
    attachment_files: number;
    attachment_bytes: number;
  };
  weekly_messages: Array<{ day: string; messages: number }>;
}
