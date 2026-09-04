/**
 * AnnouncementRepository — data-access layer for the `announcements` and
 * `announcement_reads` tables. Contains SQL only; business logic lives in the
 * services.
 *
 * Since migration 022 an announcement is targeted (scope company/department/
 * team), optionally pinned, and optionally scheduled. List/single queries are
 * viewer-scoped: non-managers only see announcements aimed at them, managers
 * see everything in their company (including scheduled drafts).
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { AnnouncementReadRow, AnnouncementRow, AnnouncementScope } from '../types';

/**
 * Computed-column fragment shared by the list + single queries:
 * read_count (how many recipients read it), is_read (did THIS viewer read
 * it — the `?` placeholder is the viewer's user id), and total_recipients
 * (size of the target audience).
 */
const ENRICH_SELECT = `
  (SELECT COUNT(*) FROM announcement_reads ar WHERE ar.announcement_id = a.id) AS read_count,
  EXISTS(SELECT 1 FROM announcement_reads ar2
         WHERE ar2.announcement_id = a.id AND ar2.user_id = ?) AS is_read,
  CASE a.scope
    WHEN 'department' THEN (SELECT COUNT(*) FROM users du WHERE du.department_id = a.department_id)
    WHEN 'team' THEN (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = a.team_id)
    ELSE (SELECT COUNT(*) FROM users cu WHERE cu.company_id = a.company_id)
  END AS total_recipients`;

/** Audience filter — non-managers only see announcements aimed at them. */
const audienceFilter = (): string => `
  AND (
    a.scope = 'company'
    OR (a.scope = 'department' AND a.department_id = ?)
    OR (a.scope = 'team' AND EXISTS (
        SELECT 1 FROM team_members tmx WHERE tmx.team_id = a.team_id AND tmx.user_id = ?
      ))
  )`;

export class AnnouncementRepository {
  constructor(private db: Db) {}

  /**
   * Announcements visible to `userId` in a company. Managers see every
   * announcement (including scheduled drafts); everyone else sees only
   * published announcements aimed at them (company / their department / their
   * teams). Pinned announcements sort first.
   */
  async findAll(
    companyId: number,
    userId: number,
    userDepartmentId: number | null,
    isManager: boolean,
  ): Promise<AnnouncementRow[]> {
    const params: unknown[] = [userId, companyId];
    let visibility = '';

    if (!isManager) {
      visibility = `${audienceFilter()} AND a.is_published = 1`;
      params.push(userDepartmentId, userId);
    }

    return this.db.query<AnnouncementRow[]>(
      `SELECT a.*,
         u.first_name as creator_first_name, u.last_name as creator_last_name,
         d.name as department_name, t.name as team_name,
         ${ENRICH_SELECT}
       FROM announcements a
       LEFT JOIN users u ON a.created_by = u.id
       LEFT JOIN departments d ON d.id = a.department_id
       LEFT JOIN teams t ON t.id = a.team_id
       WHERE a.company_id = ?
         ${visibility}
       ORDER BY a.is_pinned DESC, a.created_at DESC`,
      params,
    );
  }

  /** Raw row (no viewer enrichment) — internal use (update/delete/scheduler). */
  async findById(id: number): Promise<AnnouncementRow | null> {
    const announcements = await this.db.query<AnnouncementRow[]>(
      `SELECT a.*, u.first_name as creator_first_name, u.last_name as creator_last_name,
         d.name as department_name, t.name as team_name
       FROM announcements a
       LEFT JOIN users u ON a.created_by = u.id
       LEFT JOIN departments d ON d.id = a.department_id
       LEFT JOIN teams t ON t.id = a.team_id
       WHERE a.id = ?`,
      [id],
    );
    return announcements[0] || null;
  }

  /**
   * Single announcement enriched for a viewer. Returns null when the viewer
   * cannot see it (not in the audience, or an unpublished draft for a
   * non-manager).
   */
  async findByIdForUser(
    id: number,
    companyId: number,
    userId: number,
    userDepartmentId: number | null,
    isManager: boolean,
  ): Promise<AnnouncementRow | null> {
    // Placeholder order mirrors the SQL: enrich (viewer id), company_id, id,
    // then the audience filter (viewer department + viewer id).
    const params: unknown[] = [userId, companyId, id];
    let visibility = '';

    if (!isManager) {
      visibility = `${audienceFilter()} AND a.is_published = 1`;
      params.push(userDepartmentId, userId);
    }

    const announcements = await this.db.query<AnnouncementRow[]>(
      `SELECT a.*,
         u.first_name as creator_first_name, u.last_name as creator_last_name,
         d.name as department_name, t.name as team_name,
         ${ENRICH_SELECT}
       FROM announcements a
       LEFT JOIN users u ON a.created_by = u.id
       LEFT JOIN departments d ON d.id = a.department_id
       LEFT JOIN teams t ON t.id = a.team_id
       WHERE a.company_id = ? AND a.id = ?
         ${visibility}`,
      params,
    );
    return announcements[0] || null;
  }

  async create(data: {
    company_id: number;
    title: string;
    content: string;
    created_by: number;
    scope: AnnouncementScope;
    department_id?: number | null;
    team_id?: number | null;
    is_pinned: number;
    scheduled_at?: Date | string | null;
    is_published: number;
  }): Promise<number> {
    const {
      company_id, title, content, created_by,
      scope, department_id, team_id, is_pinned, scheduled_at, is_published,
    } = data;
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO announcements
         (company_id, scope, department_id, team_id, is_pinned, scheduled_at,
          is_published, published_at, title, content, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company_id,
        scope,
        department_id ?? null,
        team_id ?? null,
        is_pinned,
        scheduled_at ?? null,
        is_published,
        is_published ? new Date() : null,
        title,
        content,
        created_by,
      ],
    );
    return result.insertId;
  }

  async update(id: number, data: Record<string, unknown>): Promise<boolean> {
    const allowed = ['title', 'content', 'scope', 'department_id', 'team_id', 'is_pinned', 'scheduled_at', 'is_published', 'published_at'];
    const updates: string[] = [];
    const params: unknown[] = [];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key]);
      }
    }

    if (!updates.length) return false;

    params.push(id);
    const result = await this.db.query<ResultSetHeader>(
      `UPDATE announcements SET ${updates.join(', ')} WHERE id = ?`,
      params,
    );
    return result.affectedRows > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'DELETE FROM announcements WHERE id = ?',
      [id],
    );
    return result.affectedRows > 0;
  }

  // -------------------------------------------------------------------------
  // Targeting / recipient resolution
  // -------------------------------------------------------------------------

  /** The ids of every user an announcement is aimed at. */
  async findRecipientUserIds(announcement: {
    company_id: number;
    scope: AnnouncementScope;
    department_id?: number | null;
    team_id?: number | null;
  }): Promise<number[]> {
    const { company_id, scope, department_id, team_id } = announcement;
    let rows: Array<{ id: number }>;
    if (scope === 'department' && department_id) {
      rows = await this.db.query<Array<{ id: number }>>(
        'SELECT id FROM users WHERE department_id = ?',
        [department_id],
      );
    } else if (scope === 'team' && team_id) {
      rows = await this.db.query<Array<{ id: number }>>(
        'SELECT tm.user_id AS id FROM team_members tm WHERE tm.team_id = ?',
        [team_id],
      );
    } else {
      rows = await this.db.query<Array<{ id: number }>>(
        'SELECT id FROM users WHERE company_id = ?',
        [company_id],
      );
    }
    return rows.map((row) => row.id);
  }

  /** Size of an announcement's target audience. */
  async countRecipients(announcement: {
    company_id: number;
    scope: AnnouncementScope;
    department_id?: number | null;
    team_id?: number | null;
  }): Promise<number> {
    const { company_id, scope, department_id, team_id } = announcement;
    let rows: Array<{ count: number }>;
    if (scope === 'department' && department_id) {
      rows = await this.db.query<Array<{ count: number }>>(
        'SELECT COUNT(*) AS count FROM users WHERE department_id = ?',
        [department_id],
      );
    } else if (scope === 'team' && team_id) {
      rows = await this.db.query<Array<{ count: number }>>(
        'SELECT COUNT(*) AS count FROM team_members tm WHERE tm.team_id = ?',
        [team_id],
      );
    } else {
      rows = await this.db.query<Array<{ count: number }>>(
        'SELECT COUNT(*) AS count FROM users WHERE company_id = ?',
        [company_id],
      );
    }
    return Number(rows[0]?.count || 0);
  }

  /** True when `departmentId` exists inside `companyId`. */
  async departmentExists(id: number, companyId: number): Promise<boolean> {
    const rows = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM departments WHERE id = ? AND company_id = ?',
      [id, companyId],
    );
    return rows.length > 0;
  }

  /** True when `teamId` exists inside `companyId`. */
  async teamExists(id: number, companyId: number): Promise<boolean> {
    const rows = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM teams WHERE id = ? AND company_id = ?',
      [id, companyId],
    );
    return rows.length > 0;
  }

  // -------------------------------------------------------------------------
  // Read confirmation
  // -------------------------------------------------------------------------

  /** Record that a user read an announcement (idempotent; keeps first read_at). */
  async markRead(announcementId: number, userId: number): Promise<void> {
    await this.db.query<ResultSetHeader>(
      `INSERT INTO announcement_reads (announcement_id, user_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE read_at = read_at`,
      [announcementId, userId],
    );
  }

  /** Everyone who read an announcement, oldest read first. */
  async findReaders(announcementId: number): Promise<AnnouncementReadRow[]> {
    return this.db.query<AnnouncementReadRow[]>(
      `SELECT ar.id, ar.announcement_id, ar.user_id, ar.read_at,
         u.first_name, u.last_name, u.job_title
       FROM announcement_reads ar
       JOIN users u ON u.id = ar.user_id
       WHERE ar.announcement_id = ?
       ORDER BY ar.read_at ASC`,
      [announcementId],
    );
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  /** Scheduled announcements whose time has come (unpublished, due ≤ now). */
  async findDueScheduled(now: Date): Promise<AnnouncementRow[]> {
    return this.db.query<AnnouncementRow[]>(
      `SELECT * FROM announcements
       WHERE is_published = 0 AND scheduled_at IS NOT NULL AND scheduled_at <= ?
       ORDER BY scheduled_at ASC`,
      [now],
    );
  }

  /** Flip a scheduled announcement to published (idempotent). */
  async markPublished(id: number, now: Date): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      `UPDATE announcements SET is_published = 1, published_at = ?
       WHERE id = ? AND is_published = 0`,
      [now, id],
    );
    return result.affectedRows > 0;
  }
}