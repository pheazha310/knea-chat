/**
 * SystemSettingService — platform-wide settings (Super Admin console).
 * Stored as key/value rows; defaults live here so a fresh database behaves
 * sensibly before any setting is saved.
 *
 * Types: 'boolean' values are stored as '1'/'0'; 'number' values as strings.
 */
import type { SystemSettingRepository } from '../repositories/systemSettingRepository';
import type { SystemSettings } from '../types';

interface SettingDef {
  type: 'boolean' | 'number' | 'string';
  default: boolean | number | string;
  min?: number;
  max?: number;
}

const SETTING_DEFS: Record<string, SettingDef> = {
  maintenance_mode: { type: 'boolean', default: false },
  allow_public_registration: { type: 'boolean', default: true },
  password_min_length: { type: 'number', default: 6, min: 4, max: 64 },
  max_upload_size_mb: { type: 'number', default: 10, min: 1, max: 100 },
  max_users_per_org: { type: 'number', default: 0, min: 0, max: 100000 },
  allow_uploads: { type: 'boolean', default: true },
  allow_reactions: { type: 'boolean', default: true },
  allow_pinning: { type: 'boolean', default: true },
};

/** Settings exposed without authentication (client banners / forms). */
const PUBLIC_KEYS = ['maintenance_mode', 'allow_public_registration', 'password_min_length'];

const CACHE_TTL_MS = 15 * 1000;

function parseValue(def: SettingDef, raw: string): boolean | number | string {
  if (def.type === 'boolean') {
    return raw === '1' || raw === 'true';
  }
  if (def.type === 'number') {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : (def.default as number);
  }
  return raw;
}

function serializeValue(def: SettingDef, value: unknown): string {
  if (def.type === 'boolean') {
    return value ? '1' : '0';
  }
  return String(value);
}

export class SystemSettingService {
  constructor(private systemSettingRepository: SystemSettingRepository) {}

  private cache: { settings: SystemSettings | null; fetchedAt: number } = {
    settings: null,
    fetchedAt: 0,
  };

  /**
   * Read every setting from the DB, merged with typed defaults.
   *
   * Resilient: if the settings table is missing (migration not yet applied)
   * or unreadable, it falls back to defaults — everything stays open — so a
   * settings failure can never take down auth for the whole platform.
   */
  async getSettings(): Promise<SystemSettings> {
    let rows: Array<{ setting_key: string; setting_value: string }>;
    try {
      rows = await this.systemSettingRepository.getAll();
    } catch (error) {
      console.warn(
        '⚠️ Could not read system settings, using defaults:',
        (error as Error).message,
      );
      rows = [];
    }
    const stored: Record<string, string> = {};
    for (const row of rows) {
      stored[row.setting_key] = row.setting_value;
    }

    const settings = {} as SystemSettings;
    for (const [key, def] of Object.entries(SETTING_DEFS)) {
      const raw = stored[key];
      (settings as unknown as Record<string, unknown>)[key] =
        raw !== undefined ? parseValue(def, raw) : def.default;
    }
    return settings;
  }

  /**
   * Cached settings for hot paths (e.g. the auth middleware). The cache is
   * invalidated by updateSettings(), so changes apply immediately in-process.
   */
  async getCached(): Promise<SystemSettings> {
    const now = Date.now();
    if (this.cache.settings && now - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.settings;
    }
    const settings = await this.getSettings();
    this.cache = { settings, fetchedAt: now };
    return settings;
  }

  getPublicSettings(settings: SystemSettings): Record<string, unknown> {
    const subset: Record<string, unknown> = {};
    for (const key of PUBLIC_KEYS) {
      const value = (settings as unknown as Record<string, unknown>)[key];
      if (value !== undefined) subset[key] = value;
    }
    return subset;
  }

  /** Validate and persist a partial update; returns the full settings map. */
  async updateSettings(patch: Record<string, unknown>): Promise<SystemSettings> {
    const entries: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(patch)) {
      const def = SETTING_DEFS[key];
      if (!def) {
        throw new Error(`Unknown setting "${key}"`);
      }

      let parsed: unknown = value;
      if (def.type === 'boolean') {
        if (typeof value !== 'boolean') {
          throw new Error(`Setting "${key}" must be a boolean`);
        }
      } else if (def.type === 'number') {
        parsed = parseInt(String(value), 10);
        if (!Number.isFinite(parsed)) {
          throw new Error(`Setting "${key}" must be a number`);
        }
        if (
          (def.min !== undefined && (parsed as number) < def.min) ||
          (def.max !== undefined && (parsed as number) > def.max)
        ) {
          throw new Error(
            `Setting "${key}" must be between ${def.min} and ${def.max}`,
          );
        }
      }

      entries.push({ key, value: serializeValue(def, parsed) });
    }

    if (entries.length === 0) {
      throw new Error('No settings provided');
    }

    await this.systemSettingRepository.setMany(entries);
    this.cache = { settings: null, fetchedAt: 0 };

    return this.getSettings();
  }
}
