/**
 * PlatformMetricRepository — data-access layer for the Super Admin
 * monitoring dashboard (live, DB-derived statistics).
 * Contains SQL only; business logic lives in the services.
 */
import type { Db } from '../database/connection';

interface CountRow {
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
}

interface TodayRow {
  messages: number;
  users_joined: number;
  companies_created: number;
}

interface StorageRow {
  attachment_files: number;
  attachment_bytes: number;
}

export class PlatformMetricRepository {
  constructor(private db: Db) {}

  /** Headline totals across every workspace, in one pass. */
  async getCounts(): Promise<CountRow> {
    const rows = await this.db.query<CountRow[]>(
      `SELECT
         (SELECT COUNT(*) FROM companies) AS companies,
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM users WHERE is_active = 1) AS active_users,
         (SELECT COUNT(*) FROM teams) AS teams,
         (SELECT COUNT(*) FROM channels) AS channels,
         (SELECT COUNT(*) FROM departments) AS departments,
         (SELECT COUNT(*) FROM messages) AS messages,
         (SELECT COUNT(*) FROM conversations) AS conversations,
         (SELECT COUNT(*) FROM shared_files) AS shared_files,
         (SELECT COUNT(*) FROM tasks) AS tasks,
         (SELECT COUNT(*) FROM meetings) AS meetings,
         (SELECT COUNT(*) FROM announcements) AS announcements,
         (SELECT COUNT(*) FROM user_sessions WHERE expires_at > NOW()) AS active_sessions`,
    );
    const row = rows[0] || ({} as CountRow);
    const num = (value: unknown): number => Number(value) || 0;
    return {
      companies: num(row.companies),
      users: num(row.users),
      active_users: num(row.active_users),
      teams: num(row.teams),
      channels: num(row.channels),
      departments: num(row.departments),
      messages: num(row.messages),
      conversations: num(row.conversations),
      shared_files: num(row.shared_files),
      tasks: num(row.tasks),
      meetings: num(row.meetings),
      announcements: num(row.announcements),
      active_sessions: num(row.active_sessions),
    };
  }

  /** Users currently marked online (presence status, maintained live). */
  async countOnlineUsers(): Promise<number> {
    const rows = await this.db.query<Array<{ count: number }>>(
      "SELECT COUNT(*) AS count FROM users WHERE status = 'online'",
    );
    return Number(rows[0]?.count || 0);
  }

  /** Activity since midnight (server time). */
  async getToday(): Promise<TodayRow> {
    const rows = await this.db.query<TodayRow[]>(
      `SELECT
         (SELECT COUNT(*) FROM messages WHERE created_at >= CURDATE()) AS messages,
         (SELECT COUNT(*) FROM users WHERE created_at >= CURDATE()) AS users_joined,
         (SELECT COUNT(*) FROM companies WHERE created_at >= CURDATE()) AS companies_created`,
    );
    const row = rows[0] || ({} as TodayRow);
    return {
      messages: Number(row.messages) || 0,
      users_joined: Number(row.users_joined) || 0,
      companies_created: Number(row.companies_created) || 0,
    };
  }

  /** Chat attachment footprint (files + total bytes). */
  async getStorage(): Promise<StorageRow> {
    const rows = await this.db.query<StorageRow[]>(
      `SELECT COUNT(*) AS attachment_files,
              COALESCE(SUM(file_size), 0) AS attachment_bytes
       FROM attachments`,
    );
    const row = rows[0] || ({} as StorageRow);
    return {
      attachment_files: Number(row.attachment_files) || 0,
      attachment_bytes: Number(row.attachment_bytes) || 0,
    };
  }

  /** Messages sent per day over the last 7 days (oldest first). */
  async getWeeklyMessages(days = 7): Promise<Array<{ day: string; messages: number }>> {
    return this.db.query<Array<{ day: string; messages: number }>>(
      `SELECT DATE(created_at) AS day, COUNT(*) AS messages
       FROM messages
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [days],
    );
  }
}
