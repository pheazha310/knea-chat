// AuditLog domain model — MVVM Model layer.
// Administrative action trails: the Company Admin console reads its own
// company's log; the Super Admin console reads the platform-wide log.
import api from '../services/api';

export interface AuditLogEntry {
  id: number;
  company_id: number | null;
  actor_user_id: number;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  actor_first_name?: string | null;
  actor_last_name?: string | null;
  actor_email?: string | null;
}

export const AuditLogModel = {
  /** Company trail (Company Admin). */
  list: (params?: Record<string, string | number>) =>
    api.get<{ success: boolean; data: { logs: AuditLogEntry[] } }>('/audit-logs', {
      params,
    }),
  /** Platform trail (Super Admin). ?company_only=platform filters to platform-scope rows. */
  listPlatform: (params?: Record<string, string | number>) =>
    api.get<{ success: boolean; data: { logs: AuditLogEntry[] } }>('/audit-logs/platform', {
      params,
    }),
};
