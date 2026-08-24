/**
 * SystemSettingRepository — data-access layer for the `system_settings` table.
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';

export interface SettingRow {
  setting_key: string;
  setting_value: string;
}

export class SystemSettingRepository {
  constructor(private db: Db) {}

  async getAll(): Promise<SettingRow[]> {
    return this.db.query<SettingRow[]>('SELECT setting_key, setting_value FROM system_settings');
  }

  async get(key: string): Promise<string | null> {
    const rows = await this.db.query<SettingRow[]>(
      'SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1',
      [key],
    );
    return rows[0] ? rows[0].setting_value : null;
  }

  /** Upsert many settings at once. */
  async setMany(entries: Array<{ key: string; value: string }>): Promise<void> {
    for (const { key, value } of entries) {
      await this.db.query<ResultSetHeader>(
        `INSERT INTO system_settings (setting_key, setting_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, value],
      );
    }
  }
}
