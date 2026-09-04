/**
 * CompanySettingRepository — data-access layer for the `company_settings`
 * table (per-company key/value settings, mirroring `system_settings`).
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { CompanySettingRow } from '../types';

export class CompanySettingRepository {
  constructor(private db: Db) {}

  async getByCompany(companyId: number): Promise<CompanySettingRow[]> {
    return this.db.query<CompanySettingRow[]>(
      'SELECT company_id, setting_key, setting_value, updated_at FROM company_settings WHERE company_id = ?',
      [companyId],
    );
  }

  /** Upsert many settings for a company at once. */
  async setMany(companyId: number, entries: Array<{ key: string; value: string }>): Promise<void> {
    for (const { key, value } of entries) {
      await this.db.query<ResultSetHeader>(
        `INSERT INTO company_settings (company_id, setting_key, setting_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [companyId, key, value],
      );
    }
  }
}
