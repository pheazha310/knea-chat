/**
 * IntegrationConfigRepository — data-access layer for `integration_configs`
 * (migration 032): per-company/workspace configuration for external channels.
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from "../database/connection";

export type IntegrationChannel =
  | "email"
  | "telegram"
  | "website"
  | "whatsapp"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "line"
  | "zalo"
  | "vkontakte"
  | "youtube";

export interface IntegrationConfigRow {
  id: number;
  company_id: number;
  channel: IntegrationChannel;
  enabled: boolean;
  config: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateIntegrationConfigData {
  company_id: number;
  channel: IntegrationChannel;
  enabled?: boolean;
  config?: Record<string, unknown> | null;
}

export interface UpdateIntegrationConfigData {
  enabled?: boolean;
  config?: Record<string, unknown> | null;
}

export class IntegrationConfigRepository {
  constructor(private db: Db) {}

  private isMissingTableError(error: unknown): boolean {
    const err = error as { code?: string; message?: string };
    return (
      err.code === "ER_NO_SUCH_TABLE" ||
      /doesn't exist|unknown table/i.test(err.message || "")
    );
  }

  private async querySafe<T>(
    sql: string,
    values: unknown[] = [],
    fallback: T,
  ): Promise<T> {
    try {
      return await this.db.query<T>(sql, values);
    } catch (error) {
      if (this.isMissingTableError(error)) return fallback;
      throw error;
    }
  }

  async findByCompanyAndChannel(
    companyId: number,
    channel: string,
  ): Promise<IntegrationConfigRow | null> {
    const rows = await this.querySafe<IntegrationConfigRow[]>(
      "SELECT * FROM integration_configs WHERE company_id = ? AND channel = ? LIMIT 1",
      [companyId, channel],
      [],
    );
    return rows[0] || null;
  }

  async findByCompany(companyId: number): Promise<IntegrationConfigRow[]> {
    return this.querySafe<IntegrationConfigRow[]>(
      "SELECT * FROM integration_configs WHERE company_id = ? ORDER BY channel ASC",
      [companyId],
      [],
    );
  }

  async findAll(): Promise<IntegrationConfigRow[]> {
    return this.querySafe<IntegrationConfigRow[]>(
      "SELECT * FROM integration_configs ORDER BY company_id, channel",
      [],
      [],
    );
  }

  async create(data: CreateIntegrationConfigData): Promise<number> {
    try {
      const result = await this.db.query<ResultSetHeader>(
        `INSERT INTO integration_configs (company_id, channel, enabled, config)
         VALUES (?, ?, ?, ?)`,
        [
          data.company_id,
          data.channel,
          data.enabled ? 1 : 0,
          data.config ? JSON.stringify(data.config) : null,
        ],
      );
      return result.insertId;
    } catch (error) {
      if (this.isMissingTableError(error)) return 0;
      throw error;
    }
  }

  async update(
    companyId: number,
    channel: string,
    data: UpdateIntegrationConfigData,
  ): Promise<void> {
    try {
      const sets: string[] = [];
      const values: unknown[] = [];

      if (data.enabled !== undefined) {
        sets.push("enabled = ?");
        values.push(data.enabled ? 1 : 0);
      }
      if (data.config !== undefined) {
        sets.push("config = ?");
        values.push(data.config ? JSON.stringify(data.config) : null);
      }

      if (sets.length === 0) return;

      values.push(companyId, channel);
      await this.db.query(
        `UPDATE integration_configs SET ${sets.join(", ")} WHERE company_id = ? AND channel = ?`,
        values,
      );
    } catch (error) {
      if (this.isMissingTableError(error)) return;
      throw error;
    }
  }

  async upsert(data: CreateIntegrationConfigData): Promise<number> {
    const existing = await this.findByCompanyAndChannel(
      data.company_id,
      data.channel,
    );
    if (existing) {
      await this.update(data.company_id, data.channel, {
        enabled: data.enabled ?? existing.enabled,
        config: data.config ?? existing.config,
      });
      return existing.id;
    }
    return this.create(data);
  }

  async delete(companyId: number, channel: string): Promise<void> {
    try {
      await this.db.query(
        "DELETE FROM integration_configs WHERE company_id = ? AND channel = ?",
        [companyId, channel],
      );
    } catch (error) {
      if (this.isMissingTableError(error)) return;
      throw error;
    }
  }

  async deleteByCompany(companyId: number): Promise<void> {
    try {
      await this.db.query(
        "DELETE FROM integration_configs WHERE company_id = ?",
        [companyId],
      );
    } catch (error) {
      if (this.isMissingTableError(error)) return;
      throw error;
    }
  }
}

export default IntegrationConfigRepository;
