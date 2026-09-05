/**
 * TaskRepository — data-access layer for the `tasks`, `task_comments` and
 * `task_attachments` tables.
 * Contains SQL only; business logic (assignment notifications, deadlines,
 * team/role authorization) lives in TaskService.
 *
 * Team scoping conventions: `team_id` on a task links it to a team. Filters
 * treat `teamId === undefined` as "no team filter", `teamId === 0` as
 * "personal tasks (no team)", and a positive `teamId` as a specific team.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type {
  CreateTaskAttachmentData,
  CreateTaskCommentData,
  CreateTaskData,
  TaskAttachmentRow,
  TaskCommentRow,
  TaskFilters,
  TaskReactionRow,
  TaskRow,
  UpdateTaskData,
} from '../types';

const TASK_SELECT = `
  SELECT tk.*,
         a.first_name AS assignee_first_name, a.last_name AS assignee_last_name,
         a.email AS assignee_email, a.profile_picture AS assignee_profile_picture,
         c.first_name AS creator_first_name, c.last_name AS creator_last_name,
         tm.name AS team_name
  FROM tasks tk
  LEFT JOIN users a ON tk.assignee_id = a.id
  LEFT JOIN users c ON tk.created_by = c.id
  LEFT JOIN teams tm ON tk.team_id = tm.id
`;

/**
 * Build the filter clauses shared by the task queries. Extra AND clauses can
 * be appended via `prefix` (e.g. an OR visibility block).
 */
const buildWhere = (filters: TaskFilters, prefix = ''): { where: string; params: unknown[] } => {
  const { companyId, assigneeId, createdById, teamId, status, priority, search } = filters;
  let where = `WHERE tk.company_id = ?${prefix ? ` AND ${prefix}` : ''}`;
  const params: unknown[] = [companyId];

  if (assigneeId !== undefined) {
    where += ' AND tk.assignee_id = ?';
    params.push(assigneeId);
  }
  if (createdById !== undefined) {
    where += ' AND tk.created_by = ?';
    params.push(createdById);
  }
  if (teamId !== undefined) {
    if (Number(teamId) === 0) {
      where += ' AND tk.team_id IS NULL';
    } else {
      where += ' AND tk.team_id = ?';
      params.push(teamId);
    }
  }
  if (status) {
    where += ' AND tk.status = ?';
    params.push(status);
  }
  if (priority) {
    where += ' AND tk.priority = ?';
    params.push(priority);
  }
  if (search) {
    where += ' AND tk.title LIKE ?';
    params.push(`%${search}%`);
  }
  return { where, params };
};

const runQuery = async (
  db: Db,
  filters: TaskFilters,
  where: string,
  params: unknown[],
): Promise<{ tasks: TaskRow[]; total: number }> => {
  const { page = 1, limit = 50 } = filters;
  const offset = (parseInt(String(page)) - 1) * parseInt(String(limit));

  const tasks = await db.query<TaskRow[]>(
    `${TASK_SELECT} ${where}
     ORDER BY (tk.due_date IS NULL), tk.due_date ASC, tk.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, parseInt(String(limit)), offset],
  );

  const countRows = await db.query<Array<{ total: number }>>(
    `SELECT COUNT(*) AS total FROM tasks tk ${where}`,
    params,
  );
  const total = (countRows as Array<{ total: number }>)[0]?.total || 0;
  return { tasks: tasks as TaskRow[], total };
};

export class TaskRepository {
  constructor(private db: Db) {}

  async create(data: CreateTaskData): Promise<number> {
    const {
      company_id,
      created_by,
      title,
      description,
      team_id,
      assignee_id,
      due_date,
      priority,
    } = data;
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO tasks (company_id, team_id, created_by, title, description, assignee_id, due_date, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company_id,
        team_id ?? null,
        created_by,
        title,
        description || null,
        assignee_id || null,
        due_date || null,
        priority || 'medium',
      ],
    );
    return result.insertId;
  }

  async findById(id: number): Promise<TaskRow | null> {
    const rows = await this.db.query<TaskRow[]>(
      `${TASK_SELECT} WHERE tk.id = ?`,
      [id],
    );
    return rows[0] || null;
  }

  /**
   * Company-scoped query. Managers/admins see every task this way; the
   * caller is responsible for role gating.
   */
  async findAll(filters: TaskFilters): Promise<{ tasks: TaskRow[]; total: number }> {
    const { where, params } = buildWhere(filters);
    return runQuery(this.db, filters, where, params);
  }

  /**
   * Tasks visible to a specific employee: assigned to them, created by them,
   * or belonging to a team they are a member of. Other filters still apply.
   */
  async findAllVisibleToUser(
    filters: TaskFilters,
    userId: number,
  ): Promise<{ tasks: TaskRow[]; total: number }> {
    const prefix =
      '(tk.assignee_id = ? OR tk.created_by = ? OR tk.team_id IN ' +
      '(SELECT team_id FROM team_members WHERE user_id = ?))';
    const { where, params: baseParams } = buildWhere(filters, prefix);
    // buildWhere put companyId first; visibility params follow right after.
    const params = [
      ...baseParams.slice(0, 1),
      userId,
      userId,
      userId,
      ...baseParams.slice(1),
    ];
    return runQuery(this.db, filters, where, params);
  }

  /** Basic team lookup used to validate team-task scoping. */
  async findTeam(teamId: number): Promise<{ id: number; company_id: number; name: string } | null> {
    const [row] = await this.db.query<Array<{ id: number; company_id: number; name: string }>>(
      'SELECT id, company_id, name FROM teams WHERE id = ?',
      [teamId],
    );
    return row || null;
  }

  async isTeamMember(teamId: number, userId: number): Promise<boolean> {
    const [row] = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM team_members WHERE team_id = ? AND user_id = ?',
      [teamId, userId],
    );
    return !!row;
  }

  async update(id: number, data: UpdateTaskData): Promise<boolean> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.title !== undefined) {
      sets.push('title = ?');
      params.push(data.title);
    }
    if (data.description !== undefined) {
      sets.push('description = ?');
      params.push(data.description);
    }
    if (data.team_id !== undefined) {
      sets.push('team_id = ?');
      params.push(data.team_id);
    }
    if (data.assignee_id !== undefined) {
      sets.push('assignee_id = ?');
      params.push(data.assignee_id);
    }
    if (data.due_date !== undefined) {
      sets.push('due_date = ?');
      params.push(data.due_date);
    }
    if (data.priority !== undefined) {
      sets.push('priority = ?');
      params.push(data.priority);
    }
    if (data.status !== undefined) {
      sets.push('status = ?');
      params.push(data.status);
      sets.push('completed_at = ?');
      params.push(data.status === 'completed' ? new Date() : null);
    }

    if (sets.length === 0) return false;
    params.push(id);
    const result = await this.db.query<ResultSetHeader>(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    return result.affectedRows > 0;
  }

  async markDeadlineReminded(id: number, at: Date): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'UPDATE tasks SET deadline_reminded_at = ? WHERE id = ?',
      [at, id],
    );
    return result.affectedRows > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'DELETE FROM tasks WHERE id = ?',
      [id],
    );
    return result.affectedRows > 0;
  }

  /**
   * Tasks that are due (due_date <= cutoff) but not completed and never got
   * their deadline reminder. Assigned tasks only — unassigned to-dos have no
   * one to remind.
   */
  async findUnremindedDueTasks(
    cutoffDate: string,
  ): Promise<Array<{ id: number; assignee_id: number; title: string; due_date: Date | string | null }>> {
    return this.db.query<Array<{ id: number; assignee_id: number; title: string; due_date: Date | string | null }>>(
      `SELECT id, assignee_id, title, due_date FROM tasks
       WHERE status <> 'completed' AND assignee_id IS NOT NULL
         AND due_date IS NOT NULL AND due_date <= ?
         AND deadline_reminded_at IS NULL`,
      [cutoffDate],
    );
  }

  // -------------------------------------------------------------------------
  // task_comments
  // -------------------------------------------------------------------------

  async createComment(data: CreateTaskCommentData): Promise<number> {
    const { task_id, user_id, content } = data;
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO task_comments (task_id, user_id, content) VALUES (?, ?, ?)',
      [task_id, user_id, content],
    );
    return result.insertId;
  }

  async findCommentById(id: number): Promise<TaskCommentRow | null> {
    const rows = await this.db.query<TaskCommentRow[]>(
      `SELECT tc.*, u.first_name AS author_first_name, u.last_name AS author_last_name,
              u.email AS author_email, u.profile_picture AS author_profile_picture
       FROM task_comments tc
       JOIN users u ON tc.user_id = u.id
       WHERE tc.id = ?`,
      [id],
    );
    return rows[0] || null;
  }

  async findCommentsByTask(taskId: number): Promise<TaskCommentRow[]> {
    return this.db.query<TaskCommentRow[]>(
      `SELECT tc.*, u.first_name AS author_first_name, u.last_name AS author_last_name,
              u.email AS author_email, u.profile_picture AS author_profile_picture
       FROM task_comments tc
       JOIN users u ON tc.user_id = u.id
       WHERE tc.task_id = ?
       ORDER BY tc.created_at ASC`,
      [taskId],
    );
  }

  async deleteComment(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'DELETE FROM task_comments WHERE id = ?',
      [id],
    );
    return result.affectedRows > 0;
  }

  // -------------------------------------------------------------------------
  // task_attachments
  // -------------------------------------------------------------------------

  async createAttachment(data: CreateTaskAttachmentData): Promise<number> {
    const { task_id, uploaded_by, file_name, file_url, file_type, file_size } = data;
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO task_attachments (task_id, uploaded_by, file_name, file_url, file_type, file_size)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [task_id, uploaded_by, file_name, file_url, file_type || null, file_size || null],
    );
    return result.insertId;
  }

  async findAttachmentById(id: number): Promise<TaskAttachmentRow | null> {
    const rows = await this.db.query<TaskAttachmentRow[]>(
      `SELECT ta.*, u.first_name AS uploader_first_name, u.last_name AS uploader_last_name,
              u.email AS uploader_email
       FROM task_attachments ta
       JOIN users u ON ta.uploaded_by = u.id
       WHERE ta.id = ?`,
      [id],
    );
    return rows[0] || null;
  }

  async findAttachmentsByTask(taskId: number): Promise<TaskAttachmentRow[]> {
    return this.db.query<TaskAttachmentRow[]>(
      `SELECT ta.*, u.first_name AS uploader_first_name, u.last_name AS uploader_last_name,
              u.email AS uploader_email
       FROM task_attachments ta
       JOIN users u ON ta.uploaded_by = u.id
       WHERE ta.task_id = ?
       ORDER BY ta.created_at ASC`,
      [taskId],
    );
  }

  async deleteAttachment(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'DELETE FROM task_attachments WHERE id = ?',
      [id],
    );
    return result.affectedRows > 0;
  }

  // -------------------------------------------------------------------------
  // Reactions (migration 026)
  // -------------------------------------------------------------------------

  /** Idempotent add — POST means "ensure this reaction exists". */
  async addReaction(taskId: number, userId: number, reaction: string): Promise<void> {
    await this.db.query<ResultSetHeader>(
      `INSERT INTO task_reactions (task_id, user_id, reaction)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE reaction = reaction`,
      [taskId, userId, reaction],
    );
  }

  async removeReaction(taskId: number, userId: number, reaction: string): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'DELETE FROM task_reactions WHERE task_id = ? AND user_id = ? AND reaction = ?',
      [taskId, userId, reaction],
    );
    return result.affectedRows > 0;
  }

  async findReactions(taskId: number): Promise<TaskReactionRow[]> {
    return this.findReactionsByTaskIds([taskId]);
  }

  async findReactionsByTaskIds(taskIds: number[]): Promise<TaskReactionRow[]> {
    if (taskIds.length === 0) return [];
    return this.db.query<TaskReactionRow[]>(
      `SELECT tr.*, u.first_name, u.last_name, u.email, u.profile_picture
       FROM task_reactions tr
       JOIN users u ON tr.user_id = u.id
       WHERE tr.task_id IN (?)
       ORDER BY tr.created_at ASC`,
      [taskIds],
    );
  }

  /**
   * Everyone who may see a task (for live reaction broadcasts): the assignee,
   * the creator, members of the team the task belongs to, and every manager
   * of the company.
   */
  async findViewerUserIds(task: {
    company_id: number;
    team_id: number | null;
    created_by: number;
    assignee_id: number | null;
  }): Promise<number[]> {
    const { company_id, team_id, created_by, assignee_id } = task;
    const rows = await this.db.query<Array<{ id: number }>>(
      `SELECT DISTINCT id FROM (
         SELECT u.id FROM users u
         WHERE u.company_id = ? AND u.role IN ('super_admin', 'admin', 'manager')
         UNION
         SELECT ? AS id
         UNION
         SELECT tm.user_id AS id FROM team_members tm WHERE tm.team_id = ?
       ) viewers`,
      [company_id, created_by, team_id ?? 0],
    );
    const ids = rows.map((row) => Number(row.id));
    if (assignee_id !== null) ids.push(Number(assignee_id));
    return Array.from(new Set(ids)).filter((id) => Number.isFinite(id));
  }
}
