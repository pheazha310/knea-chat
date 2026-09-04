/**
 * CompanySettingService — per-company settings (Company Admin console).
 *
 * Company settings layer over the platform-wide `system_settings`:
 *   * Feature toggles (uploads / reactions / pinning) and the upload size
 *     cap default to "follow platform" — an explicit company value is AND-ed
 *     with (or capped by) the platform policy.
 *   * Security settings (password length) default to the platform minimum;
 *     the effective value is the stricter of the two.
 *   * Branding (workspace name/logo) is stored on the `companies` row.
 *
 * Types: 'boolean' stored as '1'/'0'; 'number' stored as strings — mirroring
 * SystemSettingService.
 */
import type { CompanyRepository } from '../repositories/companyRepository';
import type { CompanySettingRepository } from '../repositories/companySettingRepository';
import type { CompanyRow, SystemSettings } from '../types';

interface CompanySettingDef {
  type: 'boolean' | 'number';
  default: boolean | number;
  min?: number;
  max?: number;
}

export const COMPANY_SETTING_DEFS: Record<string, CompanySettingDef> = {
  allow_uploads: { type: 'boolean', default: true },
  allow_reactions: { type: 'boolean', default: true },
  allow_pinning: { type: 'boolean', default: true },
  max_upload_size_mb: { type: 'number', default: 10, min: 1, max: 100 },
  password_min_length: { type: 'number', default: 6, min: 4, max: 64 },
};

export type CompanySettings = {
  allow_uploads: boolean;
  allow_reactions: boolean;
  allow_pinning: boolean;
  max_upload_size_mb: number;
  password_min_length: number;
};

function parseValue(def: CompanySettingDef, raw: string): boolean | number {
  if (def.type === 'boolean') {
    return raw === '1' || raw === 'true';
  }
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : (def.default as number);
}

function serializeValue(def: CompanySettingDef, value: unknown): string {
  if (def.type === 'boolean') {
    return value ? '1' : '0';
  }
  return String(value);
}

export class CompanySettingService {
  constructor(
    private companySettingRepository: CompanySettingRepository,
    private companyRepository: CompanyRepository,
  ) {}

  /** All company settings merged with their defaults (never throws). */
  async getSettings(companyId: number): Promise<CompanySettings> {
    let rows: Array<{ setting_key: string; setting_value: string }> = [];
    try {
      rows = await this.companySettingRepository.getByCompany(companyId);
    } catch (error) {
      console.warn('⚠️ Could not read company settings, using defaults:', (error as Error).message);
      rows = [];
    }
    const stored: Record<string, string> = {};
    for (const row of rows) stored[row.setting_key] = row.setting_value;

    const settings = {} as CompanySettings;
    for (const [key, def] of Object.entries(COMPANY_SETTING_DEFS)) {
      const raw = stored[key];
      (settings as unknown as Record<string, unknown>)[key] =
        raw !== undefined ? parseValue(def, raw) : def.default;
    }
    return settings;
  }

  /** Validate + persist a partial update; returns the full settings map. */
  async updateSettings(companyId: number, patch: Record<string, unknown>): Promise<CompanySettings> {
    const entries: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(patch)) {
      const def = COMPANY_SETTING_DEFS[key];
      if (!def) {
        throw new Error(`Unknown company setting "${key}"`);
      }
      let parsed: unknown = value;
      if (def.type === 'boolean') {
        if (typeof value !== 'boolean') {
          throw new Error(`Setting "${key}" must be a boolean`);
        }
      } else {
        parsed = parseInt(String(value), 10);
        if (!Number.isFinite(parsed)) {
          throw new Error(`Setting "${key}" must be a number`);
        }
        if (
          (def.min !== undefined && (parsed as number) < def.min) ||
          (def.max !== undefined && (parsed as number) > def.max)
        ) {
          throw new Error(`Setting "${key}" must be between ${def.min} and ${def.max}`);
        }
      }
      entries.push({ key, value: serializeValue(def, parsed) });
    }
    if (entries.length === 0) {
      throw new Error('No settings provided');
    }
    await this.companySettingRepository.setMany(companyId, entries);
    return this.getSettings(companyId);
  }

  /** Workspace branding — name/logo live on the `companies` row. */
  async updateProfile(
    companyId: number,
    patch: { name?: string; logo?: string | null },
  ): Promise<CompanyRow> {
    const company = await this.companyRepository.findById(companyId);
    if (!company) {
      throw new Error('Workspace not found');
    }
    const updates: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = (patch.name || '').trim();
      if (!name) {
        throw new Error('Workspace name is required');
      }
      updates.name = name;
    }
    if (patch.logo !== undefined) updates.logo = patch.logo || null;
    if (Object.keys(updates).length > 0) {
      const ok = await this.companyRepository.update(companyId, updates);
      if (!ok) throw new Error('Failed to update workspace');
    }
    const refreshed = await this.companyRepository.findById(companyId);
    if (!refreshed) throw new Error('Workspace not found');
    return refreshed;
  }

  /**
   * The effective messaging policy for a company: company feature settings
   * AND-ed with the platform policy, and the company upload cap never
   * exceeding the platform cap. Enforcement points (message upload, pinning,
   * reactions, password changes) consult this.
   */
  async effectiveFeaturePolicy(
    companyId: number,
    platform: Pick<
      SystemSettings,
      'allow_uploads' | 'allow_reactions' | 'allow_pinning' | 'max_upload_size_mb' | 'password_min_length'
    >,
  ): Promise<{
    allow_uploads: boolean;
    allow_reactions: boolean;
    allow_pinning: boolean;
    max_upload_size_mb: number;
    password_min_length: number;
  }> {
    const company = await this.getSettings(companyId);
    return {
      allow_uploads: platform.allow_uploads && company.allow_uploads,
      allow_reactions: platform.allow_reactions && company.allow_reactions,
      allow_pinning: platform.allow_pinning && company.allow_pinning,
      max_upload_size_mb: Math.min(company.max_upload_size_mb, platform.max_upload_size_mb),
      password_min_length: Math.max(company.password_min_length, platform.password_min_length),
    };
  }
}
