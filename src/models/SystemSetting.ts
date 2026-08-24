// SystemSetting domain model — MVVM Model layer.
// Holds the `SystemSettings` entity plus `SystemSettingModel`, the data
// access for the /settings endpoints.
import api from '../services/api';

export interface SystemSettings {
  maintenance_mode: boolean;
  allow_public_registration: boolean;
  password_min_length: number;
  max_upload_size_mb: number;
  max_users_per_org: number;
  allow_uploads: boolean;
  allow_reactions: boolean;
  allow_pinning: boolean;
}

export const SystemSettingModel = {
  /** Public subset — no auth, used by the login page. */
  getPublic: () =>
    api.get<{
      success: boolean;
      data: { settings: Partial<SystemSettings> };
    }>('/settings/public'),
  getAll: () =>
    api.get<{ success: boolean; data: { settings: SystemSettings } }>('/settings'),
  update: (patch: Partial<SystemSettings>) =>
    api.patch<{ success: boolean; data: { settings: SystemSettings } }>(
      '/settings',
      patch,
    ),
};
