/**
 * GlobalSearchRepository — data-access layer for the workspace-wide Search
 * view (SRS US-17 / FR-16).
 *
 * Runs one query per scope (messages, people, teams, channels, files,
 * meetings, tasks). Every scope is company-scoped and mirrors the access
 * rules already enforced by the entity's own list/search endpoints:
 *
 *   - messages : same predicate as MessageRepository.search (team
 *                conversations restricted to members + managers/admins)
 *   - files    : same rules as SharedFileRepository.canAccess (public /
 *                uploader / explicit permission / team or share destination)
 *   - tasks    : managers+ see all; employees only tasks they were assigned,
 *                created, or whose team they belong to
 *   - teams / channels / meetings / people: company-wide lists, matching
 *     the Channels/Teams/Meetings views and the /search/users endpoint
 *
 * `q` is optional — a pure filter query is valid. The filter bag is applied
 * only to the scopes where each filter is meaningful (e.g. message_type only
 * narrows messages, file_type only files, due-date for tasks vs meeting date
 * for meetings).
 */
import type { Db } from '../database/connection';
import type { MeetingRow } from '../types/Meeting';
import type { SharedFileRow } from '../types/SharedFile';
import type { TaskRow } from '../types/Task';
import type { UserRow } from '../types/User';
import type {
  GlobalSearchFilters,
  SearchChannelRow,
  SearchGroupResult,
  SearchMessageRow,
  SearchTeamRow,
} from '../types/Search';

/** Roles that see every file / task / team conversation in their company. */
const PRIVILEGED_ROLES = ['super_admin', 'admin', 'manager'];

/** The requester info every scope query needs. */
interface SearchCtx {
  userId: number;
  companyId: number;
  role: string;
}

/** Column name used by a scope's primary date (created_at / due_date …). */
type DateColumn = string;

export class GlobalSearchRepository {
  constructor(private db: Db) {}

  // -------------------------------------------------------------------------
  // Query plumbing
  // -------------------------------------------------------------------------

  /** Runs the row query + a COUNT over the same WHERE. */
  private async run<T>(
    selectSql: string,
    countSql: string,
    params: unknown[],
    limit: number,
    offset: number,
  ): Promise<{ items: T[]; total: number }> {
    const [items, countRows] = await Promise.all([
      this.db.query<T[]>(`${selectSql} LIMIT ? OFFSET ?`, [...params, limit, offset]),
      this.db.query<Array<{ total: number }>>(countSql, params),
    ]);
    const total = parseInt(String((countRows as Array<{ total: number }>)[0]?.total || 0), 10);
    return { items: items as T[], total };
  }

  /** Pushes inclusive date bounds (`YYYY-MM-DD`) for a datetime/date column. */
  private addDateRange(
    column: DateColumn,
    filters: GlobalSearchFilters,
    clauses: string[],
    params: unknown[],
  ): void {
    if (filters.date_from) {
      clauses.push(`${column} >= ?`);
      params.push(`${filters.date_from} 00:00:00`);
    }
    if (filters.date_to) {
      clauses.push(`${column} <= ?`);
      params.push(`${filters.date_to} 23:59:59`);
    }
  }

  private privileged(role: string): boolean {
    return PRIVILEGED_ROLES.includes(role);
  }

  /**
   * File-type filter vocabulary used by the Search view. Each token maps to
   * the MIME patterns that belong to that group (the stored file_type is a
   * MIME string, e.g. `application/pdf` or `image/png`).
   */
  private addFileTypeClause(
    clauses: string[],
    params: unknown[],
    fileType: string,
  ): void {
    const groups: Record<string, Array<string | { like: string }>> = {
      image: [{ like: 'image/%' }],
      video: [{ like: 'video/%' }],
      audio: [{ like: 'audio/%' }],
      text: [{ like: 'text/%' }],
      pdf: ['application/pdf'],
      word: [
        'application/msword',
        { like: 'application/vnd.openxmlformats-officedocument.wordprocessingml%' },
      ],
      excel: [
        'application/vnd.ms-excel',
        { like: 'application/vnd.openxmlformats-officedocument.spreadsheetml%' },
      ],
      powerpoint: [
        'application/vnd.ms-powerpoint',
        { like: 'application/vnd.openxmlformats-officedocument.presentationml%' },
      ],
      archive: [
        'application/zip',
        'application/x-zip-compressed',
        'application/gzip',
        { like: 'application/x-rar%' },
      ],
    };
    const patterns = groups[fileType];
    if (!patterns) return;
    const ors = patterns.map((p) =>
      typeof p === 'string'
        ? 'company_owner.file_type = ?'
        : 'company_owner.file_type LIKE ?',
    );
    clauses.push(`(${ors.join(' OR ')})`);
    for (const p of patterns) {
      params.push(typeof p === 'string' ? p : p.like);
    }
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  async searchMessages(
    ctx: SearchCtx,
    filters: GlobalSearchFilters,
    page = 1,
    limit = 20,
  ): Promise<SearchGroupResult<SearchMessageRow>> {
    const fromJoin =
      'FROM messages m\n' +
      'JOIN users u ON m.sender_id = u.id\n' +
      'JOIN conversations c ON m.conversation_id = c.id\n' +
      'JOIN users company_owner ON company_owner.id = ?';
    const params: unknown[] = [ctx.userId];
    const clauses = [
      'm.deleted_at IS NULL',
      // A message is only shown when the searcher can actually open it:
      //   - they are a conversation member (DM/group participants only), or
      //   - it is a company channel conversation (channels stay company-wide
      //     and self-join on open, as in the Channels view), or
      //   - it is a team conversation they may read (member + privileged
      //     roles — never leaks into a non-member's results).
      `(
        EXISTS (
          SELECT 1 FROM conversation_members cm_me
          WHERE cm_me.conversation_id = c.id AND cm_me.user_id = company_owner.id
        )
        OR (
          c.type = 'channel'
          AND EXISTS (
            SELECT 1 FROM channels ch
            WHERE ch.name = c.name AND ch.company_id = company_owner.company_id
              AND ch.is_archived = 0
          )
        )
        OR (
          c.type = 'team'
          AND (
            company_owner.role = ?
            OR EXISTS (
              SELECT 1 FROM teams t
              JOIN team_members tm ON tm.team_id = t.id
              WHERE t.name = c.name AND t.company_id = company_owner.company_id
                AND tm.user_id = company_owner.id
            )
          )
        )
      )`,
    ];
    params.push(ctx.role);

    if (filters.q) {
      clauses.push('m.content LIKE ?');
      params.push(`%${filters.q}%`);
    }
    if (filters.person_id) {
      clauses.push('m.sender_id = ?');
      params.push(filters.person_id);
    }
    if (filters.message_type) {
      clauses.push('m.type = ?');
      params.push(filters.message_type);
    }
    if (filters.department_id) {
      clauses.push('u.department_id = ?');
      params.push(filters.department_id);
    }
    if (filters.team_id) {
      // Team filter: conversations of the selected team (type 'team', named
      // after the team) or channel conversations inside that team.
      clauses.push(`(
        (c.type = 'team' AND EXISTS (
          SELECT 1 FROM teams tsel
          WHERE tsel.id = ? AND tsel.company_id = company_owner.company_id AND tsel.name = c.name
        ))
        OR EXISTS (
          SELECT 1 FROM channels csel
          WHERE csel.name = c.name AND csel.company_id = company_owner.company_id AND csel.team_id = ?
        )
      )`);
      params.push(filters.team_id, filters.team_id);
    }
    this.addDateRange('m.created_at', filters, clauses, params);

    const where = `WHERE ${clauses.join('\n  AND ')}`;
    const selectSql =
      `SELECT m.*, u.first_name, u.last_name, u.email, u.profile_picture,\n` +
      `       u.department_id AS sender_department_id,\n` +
      `       c.type AS conversation_type, c.name AS conversation_name\n${fromJoin}\n${where}\nORDER BY m.created_at DESC`;
    const countSql = `SELECT COUNT(*) AS total ${fromJoin}\n${where}`;

    return this.paged(selectSql, countSql, params, page, limit);
  }

  // -------------------------------------------------------------------------
  // People
  // -------------------------------------------------------------------------

  async searchPeople(
    ctx: SearchCtx,
    filters: GlobalSearchFilters,
    page = 1,
    limit = 20,
  ): Promise<SearchGroupResult<UserRow>> {
    const fromJoin = 'FROM users company_owner';
    const params: unknown[] = [ctx.companyId];
    const clauses: string[] = [
      'company_owner.is_active = 1',
      'company_owner.company_id = ?',
    ];

    if (filters.q) {
      clauses.push(
        '(company_owner.first_name LIKE ? OR company_owner.last_name LIKE ? OR company_owner.email LIKE ? OR company_owner.job_title LIKE ?)',
      );
      params.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`);
    }
    if (filters.person_id) {
      clauses.push('company_owner.id = ?');
      params.push(filters.person_id);
    }
    if (filters.department_id) {
      clauses.push('company_owner.department_id = ?');
      params.push(filters.department_id);
    }
    if (filters.team_id) {
      clauses.push(`EXISTS (
        SELECT 1 FROM team_members tm
        WHERE tm.user_id = company_owner.id AND tm.team_id = ?
      )`);
      params.push(filters.team_id);
    }

    const selectSql =
      `SELECT company_owner.id, company_owner.company_id, company_owner.department_id,\n` +
      `       company_owner.manager_id, company_owner.first_name, company_owner.last_name,\n` +
      `       company_owner.email, company_owner.role, company_owner.job_title,\n` +
      `       company_owner.profile_picture, company_owner.status, company_owner.is_active,\n` +
      `       company_owner.last_seen_at, company_owner.created_at, company_owner.updated_at\n` +
      `${fromJoin}\nWHERE ${clauses.join('\n  AND ')}\nORDER BY company_owner.first_name ASC, company_owner.last_name ASC`;
    const countSql = `SELECT COUNT(*) AS total ${fromJoin}\nWHERE ${clauses.join('\n  AND ')}`;

    return this.paged(selectSql, countSql, params, page, limit);
  }

  // -------------------------------------------------------------------------
  // Teams
  // -------------------------------------------------------------------------

  async searchTeams(
    ctx: SearchCtx,
    filters: GlobalSearchFilters,
    page = 1,
    limit = 20,
  ): Promise<SearchGroupResult<SearchTeamRow>> {
    const fromJoin =
      'FROM teams company_owner\n' +
      'LEFT JOIN users u ON company_owner.created_by = u.id\n' +
      'LEFT JOIN departments d ON company_owner.department_id = d.id';
    const params: unknown[] = [ctx.companyId];
    const clauses: string[] = [];

    if (filters.q) {
      clauses.push('(company_owner.name LIKE ? OR company_owner.description LIKE ?)');
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    if (filters.team_id) {
      clauses.push('company_owner.id = ?');
      params.push(filters.team_id);
    }
    if (filters.person_id) {
      clauses.push('company_owner.created_by = ?');
      params.push(filters.person_id);
    }
    if (filters.department_id) {
      clauses.push('company_owner.department_id = ?');
      params.push(filters.department_id);
    }
    this.addDateRange('company_owner.created_at', filters, clauses, params);

    const selectSql =
      `SELECT company_owner.*, u.first_name AS manager_first_name, u.last_name AS manager_last_name,\n` +
      `       d.name AS department_name,\n` +
      `       (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = company_owner.id) AS member_count\n` +
      `${fromJoin}\nWHERE company_owner.company_id = ?\n${clauses.length ? `  AND ${clauses.join('\n  AND ')}` : ''}\nORDER BY company_owner.name ASC`;
    const countSql =
      `SELECT COUNT(*) AS total ${fromJoin}\nWHERE company_owner.company_id = ?\n${clauses.length ? `  AND ${clauses.join('\n  AND ')}` : ''}`;

    return this.paged(selectSql, countSql, params, page, limit);
  }

  // -------------------------------------------------------------------------
  // Channels
  // -------------------------------------------------------------------------

  async searchChannels(
    ctx: SearchCtx,
    filters: GlobalSearchFilters,
    page = 1,
    limit = 20,
  ): Promise<SearchGroupResult<SearchChannelRow>> {
    const fromJoin =
      'FROM channels company_owner\n' +
      'LEFT JOIN users u ON company_owner.created_by = u.id\n' +
      'LEFT JOIN teams t ON company_owner.team_id = t.id';
    const params: unknown[] = [ctx.companyId];
    const clauses: string[] = ['company_owner.is_archived = 0'];

    if (filters.q) {
      clauses.push('(company_owner.name LIKE ? OR company_owner.description LIKE ?)');
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    if (filters.team_id) {
      clauses.push('company_owner.team_id = ?');
      params.push(filters.team_id);
    }
    if (filters.person_id) {
      clauses.push('company_owner.created_by = ?');
      params.push(filters.person_id);
    }
    if (filters.department_id) {
      clauses.push(`EXISTS (
        SELECT 1 FROM teams dept_team
        WHERE dept_team.id = company_owner.team_id AND dept_team.department_id = ?
      )`);
      params.push(filters.department_id);
    }
    this.addDateRange('company_owner.created_at', filters, clauses, params);

    const selectSql =
      `SELECT company_owner.*, u.first_name AS creator_first_name, u.last_name AS creator_last_name,\n` +
      `       t.name AS team_name,\n` +
      `       (SELECT COUNT(*) FROM channel_members cm WHERE cm.channel_id = company_owner.id) AS member_count\n` +
      `${fromJoin}\nWHERE company_owner.company_id = ?\n  AND ${clauses.join('\n  AND ')}\nORDER BY company_owner.name ASC`;
    const countSql =
      `SELECT COUNT(*) AS total ${fromJoin}\nWHERE company_owner.company_id = ?\n  AND ${clauses.join('\n  AND ')}`;

    return this.paged(selectSql, countSql, params, page, limit);
  }

  // -------------------------------------------------------------------------
  // Shared files (access-scoped like SharedFileRepository.canAccess)
  // -------------------------------------------------------------------------

  async searchFiles(
    ctx: SearchCtx,
    filters: GlobalSearchFilters,
    page = 1,
    limit = 20,
  ): Promise<SearchGroupResult<SharedFileRow>> {
    const fromJoin =
      'FROM shared_files company_owner\n' +
      'JOIN users u ON company_owner.uploaded_by = u.id\n' +
      'LEFT JOIN teams t ON company_owner.team_id = t.id';
    const params: unknown[] = [ctx.companyId];
    const clauses: string[] = [];

    if (this.privileged(ctx.role)) {
      // Managers/admins can access every file in their own company.
    } else {
      clauses.push(`(
        company_owner.is_public = 1
        OR company_owner.uploaded_by = ?
        OR EXISTS (SELECT 1 FROM file_permissions fp WHERE fp.file_id = company_owner.id AND fp.user_id = ?)
        OR (company_owner.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM team_members tm WHERE tm.team_id = company_owner.team_id AND tm.user_id = ?
        ))
        OR EXISTS (
          SELECT 1 FROM file_shares fs
          WHERE fs.file_id = company_owner.id AND (
            (fs.target_type = 'team' AND EXISTS (
              SELECT 1 FROM team_members tm2 WHERE tm2.team_id = fs.target_id AND tm2.user_id = ?
            ))
            OR (fs.target_type = 'conversation' AND EXISTS (
              SELECT 1 FROM conversation_members cm2 WHERE cm2.conversation_id = fs.target_id AND cm2.user_id = ?
            ))
          )
        )
      )`);
      params.push(ctx.userId, ctx.userId, ctx.userId, ctx.userId, ctx.userId);
    }

    if (filters.q) {
      clauses.push('(company_owner.file_name LIKE ? OR company_owner.description LIKE ?)');
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    if (filters.person_id) {
      clauses.push('company_owner.uploaded_by = ?');
      params.push(filters.person_id);
    }
    if (filters.team_id) {
      clauses.push('company_owner.team_id = ?');
      params.push(filters.team_id);
    }
    if (filters.department_id) {
      clauses.push('u.department_id = ?');
      params.push(filters.department_id);
    }
    if (filters.file_type) {
      this.addFileTypeClause(clauses, params, filters.file_type);
    }
    this.addDateRange('company_owner.created_at', filters, clauses, params);

    const selectSql =
      `SELECT company_owner.*, t.name AS team_name,\n` +
      `       u.first_name AS uploader_first_name, u.last_name AS uploader_last_name,\n` +
      `       u.email AS uploader_email, u.profile_picture AS uploader_profile_picture,\n` +
      `       u.department_id AS uploader_department_id\n` +
      `${fromJoin}\nWHERE company_owner.company_id = ?\n${clauses.length ? `  AND ${clauses.join('\n  AND ')}` : ''}\nORDER BY company_owner.created_at DESC`;
    const countSql =
      `SELECT COUNT(*) AS total ${fromJoin}\nWHERE company_owner.company_id = ?\n${clauses.length ? `  AND ${clauses.join('\n  AND ')}` : ''}`;

    return this.paged(selectSql, countSql, params, page, limit);
  }

  // -------------------------------------------------------------------------
  // Meetings
  // -------------------------------------------------------------------------

  async searchMeetings(
    ctx: SearchCtx,
    filters: GlobalSearchFilters,
    page = 1,
    limit = 20,
  ): Promise<SearchGroupResult<MeetingRow>> {
    const fromJoin =
      'FROM meetings company_owner\n' +
      'LEFT JOIN users u ON company_owner.organizer_id = u.id';
    const params: unknown[] = [ctx.companyId];
    const clauses: string[] = [];

    if (filters.q) {
      clauses.push('(company_owner.title LIKE ? OR company_owner.description LIKE ?)');
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    if (filters.person_id) {
      clauses.push(`(company_owner.organizer_id = ? OR EXISTS (
        SELECT 1 FROM meeting_attendees ma
        WHERE ma.meeting_id = company_owner.id AND ma.user_id = ?
      ))`);
      params.push(filters.person_id, filters.person_id);
    }
    if (filters.team_id) {
      clauses.push(`(EXISTS (
        SELECT 1 FROM team_members tm3 JOIN teams tt3 ON tt3.id = tm3.team_id
        WHERE tm3.user_id = company_owner.organizer_id AND tt3.id = ? AND tt3.company_id = company_owner.company_id
      ) OR EXISTS (
        SELECT 1 FROM meeting_attendees ma4 JOIN team_members tm4 ON tm4.user_id = ma4.user_id
        WHERE ma4.meeting_id = company_owner.id AND tm4.team_id = ?
      ))`);
      params.push(filters.team_id, filters.team_id);
    }
    if (filters.department_id) {
      clauses.push('u.department_id = ?');
      params.push(filters.department_id);
    }
    this.addDateRange('company_owner.meeting_date', filters, clauses, params);

    const selectSql =
      `SELECT company_owner.*, u.first_name AS organizer_first_name, u.last_name AS organizer_last_name,\n` +
      `       u.department_id AS organizer_department_id\n` +
      `${fromJoin}\nWHERE company_owner.company_id = ?\n${clauses.length ? `  AND ${clauses.join('\n  AND ')}` : ''}\nORDER BY company_owner.meeting_date DESC, company_owner.start_time ASC`;
    const countSql =
      `SELECT COUNT(*) AS total ${fromJoin}\nWHERE company_owner.company_id = ?\n${clauses.length ? `  AND ${clauses.join('\n  AND ')}` : ''}`;

    return this.paged(selectSql, countSql, params, page, limit);
  }

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  async searchTasks(
    ctx: SearchCtx,
    filters: GlobalSearchFilters,
    page = 1,
    limit = 20,
  ): Promise<SearchGroupResult<TaskRow>> {
    const fromJoin =
      'FROM tasks company_owner\n' +
      'LEFT JOIN users a ON company_owner.assignee_id = a.id\n' +
      'LEFT JOIN users c ON company_owner.created_by = c.id\n' +
      'LEFT JOIN teams tm ON company_owner.team_id = tm.id';
    const params: unknown[] = [ctx.companyId];
    const clauses: string[] = [];

    if (!this.privileged(ctx.role)) {
      // Employees only see their own / created / team tasks.
      clauses.push(`(
        company_owner.assignee_id = ?
        OR company_owner.created_by = ?
        OR company_owner.team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
      )`);
      params.push(ctx.userId, ctx.userId, ctx.userId);
    }

    if (filters.q) {
      clauses.push('(company_owner.title LIKE ? OR company_owner.description LIKE ?)');
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    if (filters.person_id) {
      clauses.push('(company_owner.assignee_id = ? OR company_owner.created_by = ?)');
      params.push(filters.person_id, filters.person_id);
    }
    if (filters.team_id) {
      clauses.push('company_owner.team_id = ?');
      params.push(filters.team_id);
    }
    if (filters.department_id) {
      clauses.push('(a.department_id = ? OR c.department_id = ?)');
      params.push(filters.department_id, filters.department_id);
    }
    // Date filter on tasks means the due date.
    this.addDateRange('company_owner.due_date', filters, clauses, params);

    const selectSql =
      `SELECT company_owner.*,\n` +
      `       a.first_name AS assignee_first_name, a.last_name AS assignee_last_name,\n` +
      `       a.email AS assignee_email, a.profile_picture AS assignee_profile_picture,\n` +
      `       c.first_name AS creator_first_name, c.last_name AS creator_last_name,\n` +
      `       tm.name AS team_name\n` +
      `${fromJoin}\nWHERE company_owner.company_id = ?\n${clauses.length ? `  AND ${clauses.join('\n  AND ')}` : ''}\nORDER BY company_owner.created_at DESC`;
    const countSql =
      `SELECT COUNT(*) AS total ${fromJoin}\nWHERE company_owner.company_id = ?\n${clauses.length ? `  AND ${clauses.join('\n  AND ')}` : ''}`;

    return this.paged(selectSql, countSql, params, page, limit);
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  private async paged<T>(
    selectSql: string,
    countSql: string,
    params: unknown[],
    page: number,
    limit: number,
  ): Promise<SearchGroupResult<T>> {
    const safePage = Math.max(1, parseInt(String(page), 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const offset = (safePage - 1) * safeLimit;
    const { items, total } = await this.run<T>(selectSql, countSql, params, safeLimit, offset);
    return { items, total, page: safePage, limit: safeLimit };
  }
}
