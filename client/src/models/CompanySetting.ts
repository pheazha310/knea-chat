// CompanySetting domain model — MVVM Model layer.
// Company-scoped settings (branding + feature/security toggles) managed by
// the Company Admin console (/api/company-settings).
import api from '../services/api';
import type { Company } from './Company';

export interface CompanySettings {
  allow_uploads: boolean;
  allow_reactions: boolean;
  allow_pinning: boolean;
  max_upload_size_mb: number;
  password_min_length: number;
}

export interface CompanySettingsBundle {
  settings: CompanySettings;
  company: Company;
}

export const CompanySettingModel = {
  get: () =>
    api.get<{ success: boolean; data: CompanySettingsBundle }>('/company-settings'),
  /** PATCH profile + settings in one call: { name?, logo?, settings? }. */
  update: (patch: {
    name?: string;
    logo?: string;
    settings?: Partial<CompanySettings>;
  }) =>
    api.patch<{ success: boolean; data: CompanySettingsBundle }>(
      '/company-settings',
      patch,
    ),
};
