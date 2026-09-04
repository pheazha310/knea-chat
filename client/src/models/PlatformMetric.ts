// PlatformMetric domain model — MVVM Model layer.
// Live platform statistics for the Super Admin monitoring dashboard
// (/api/admin/metrics).
import api from '../services/api';

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

export const PlatformMetricModel = {
  get: () =>
    api.get<{ success: boolean; data: { metrics: PlatformMetrics } }>(
      '/admin/metrics',
    ),
};
