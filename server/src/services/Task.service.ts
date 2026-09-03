/**
 * TaskService — business logic for tasks (create, assign, team scope, status,
 * deadlines, comments, attachments).
 *
 * Roles: managers/admins may assign to anyone in the company and manage any
 * task; employees can create tasks for themselves (optionally inside a team
 * they belong to) and change the status of tasks assigned to them or of team
 * tasks in teams they belong to. Assignments and due-date alerts produce
 * notifications (category 'tasks') that honor each user's notification
 * preferences.
 *
 * Team scoping: a task with `team_id` is a *team task* — visible to the team's
 * members (plus the assignee/creator and managers). A task without one is a
 * *personal task*, visible to its assignee and creator.
 */
import type { TaskRepository } from '../repositories/taskRepository';
import type { NotificationRepository } from '../repositories/notificationRepository';
import type { UserRepository } from '../repositories/userRepository';
import type { NotificationPreferenceService } from './NotificationPreference.service';
import { sendToUser } from '../websocket/connection.registry';
import type {
  CreateTaskData,
  TaskFilters,
  TaskRow,
  UpdateTaskData,
  TaskCommentRow,
  CreateTaskCommentData,
  TaskAttachmentRow,
  CreateTaskAttachmentData,
} from '../types';

const MANAGER_ROLES = ['super_admin', 'admin', 'manager'];
const PRIORITIES = new Set(['low', 'medium', 'high']);
const STATUSES = new Set(['open', 'in_progress', 'completed']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const dateOnly = (value: Date): string => {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** Normalize a DB DATE value (string or JS Date) to a YYYY-MM-DD key. */
const dueDateOnly = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) return dateOnly(value);
  return String(value).slice(0, 10);
};

const assertValidTaskFields = (data: {
  title?: string;
  due_date?: string | null;
  priority?: string;
  status?: string;
}): void => {
  if (data.title !== undefined && !String(data.title).trim()) {
    throw new Error('Task title is required');
  }
  if (data.due_date !== undefined && data.due_date !== null && !DATE_RE.test(String(data.due_date))) {
    throw new Error('due_date must be in YYYY-MM-DD format');
  }
  if (data.priority !== undefined && !PRIORITIES.has(String(data.priority))) {
    throw new Error('priority must be low, medium or high');
  }
  if (data.status !== undefined && !STATUSES.has(String(data.status))) {
    throw new Error('status must be open, in_progress or completed');
  }
};

export class TaskService {
  constructor(
    private taskRepository: TaskRepository,
    private notificationRepository: NotificationRepository,
    private userRepository: UserRepository,
    private notificationPreferences?: NotificationPreferenceService | null,
  ) {}

  private isManager(role: string): boolean {
    return MANAGER_ROLES.includes(role);
  }

  /** Mark overdue on rows whose due date passed without completion. */
  private annotateOverdue(task: TaskRow, today: string): TaskRow {
    const due = dueDateOnly(task.due_date);
    task.is_overdue = !!due && due < today && task.status !== 'completed';
    return task;
  }

  /**
   * Resolve the acting user and assert they may see `task`. Employees may see
   * a task they were assigned, created, or that belongs to a team they are a
   * member of; managers/admins may see any task in their own company.
   */
  private async assertCanViewTask(task: TaskRow, userId: number): Promise<{ role: string }> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new Error('User not found');
    const isPrivileged = this.isManager(user.role);
    if (isPrivileged && Number(user.company_id) === Number(task.company_id)) {
      return { role: user.role };
    }
    const isAssignee = task.assignee_id !== null && Number(task.assignee_id) === userId;
    const isCreator = Number(task.created_by) === userId;
    const isTeamMember = task.team_id
      ? await this.taskRepository.isTeamMember(Number(task.team_id), userId)
      : false;
    if (!isAssignee && !isCreator && !isTeamMember) {
      throw new Error('You do not have permission to access this task');
    }
    return { role: user.role };
  }

  async listTasks(
    userId: number,
    role: string,
    companyId: number,
    filters: Omit<TaskFilters, 'companyId'> = {},
  ): Promise<{ tasks: TaskRow[]; total: number }> {
    const scoped: TaskFilters = { ...filters, companyId };
    let result: { tasks: TaskRow[]; total: number };
    if (this.isManager(role)) {
      result = await this.taskRepository.findAll(scoped);
    } else {
      // Employees: tasks assigned to them, created by them, or in teams they
      // belong to. A positive teamId filter is safe: visibility is gated by
      // the query itself. teamId === 0 filters personal tasks.
      result = await this.taskRepository.findAllVisibleToUser(scoped, userId);
    }
    const today = dateOnly(new Date());
    result.tasks.forEach((t) => this.annotateOverdue(t, today));
    return result;
  }

  async createTask(data: CreateTaskData & { role: string }): Promise<TaskRow> {
    const { role, assignee_id, team_id } = data;
    const title = (data.title || '').trim();
    assertValidTaskFields({ title, due_date: data.due_date ?? null, priority: data.priority });
    if (!title) throw new Error('Task title is required');
    if (assignee_id && Number(assignee_id) !== Number(data.created_by) && !this.isManager(role)) {
      throw new Error('Only managers can assign tasks to other employees');
    }

    if (assignee_id) {
      const assignee = await this.userRepository.findById(Number(assignee_id));
      if (!assignee) throw new Error('Assignee not found');
      if (Number(assignee.company_id) !== Number(data.company_id)) {
        throw new Error('You can only assign tasks within your company');
      }
    }

    // Team scoping: the team must exist in the same company, and employees
    // may only create team tasks in teams they belong to.
    if (team_id) {
      const team = await this.taskRepository.findTeam(Number(team_id));
      if (!team) throw new Error('Team not found');
      if (Number(team.company_id) !== Number(data.company_id)) {
        throw new Error('You can only create tasks in teams of your company');
      }
      if (!this.isManager(role) && !(await this.taskRepository.isTeamMember(Number(team_id), Number(data.created_by)))) {
        throw new Error('You can only create tasks in teams you are a member of');
      }
    }

    const taskId = await this.taskRepository.create({
      company_id: data.company_id,
      created_by: data.created_by,
      title,
      description: data.description ?? null,
      team_id: team_id ?? null,
      assignee_id: assignee_id ?? null,
      due_date: data.due_date || null,
      priority: data.priority,
    });

    const task = await this.taskRepository.findById(taskId);
    if (!task) throw new Error('Failed to create task');

    if (assignee_id && Number(assignee_id) !== Number(data.created_by)) {
      await this.notifyAssigned(task, data.created_by);
    }
    return task;
  }

  async updateTask(
    taskId: number,
    userId: number,
    role: string,
    data: UpdateTaskData,
  ): Promise<TaskRow> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) throw new Error('Task not found');

    assertValidTaskFields(data);

    const isAssignee = task.assignee_id !== null && Number(task.assignee_id) === Number(userId);
    const isCreator = Number(task.created_by) === Number(userId);
    const canManage = this.isManager(role) || isCreator;
    // Team members may move a team task between statuses (kanban drag).
    const isTeamMember =
      !canManage && task.team_id
        ? await this.taskRepository.isTeamMember(Number(task.team_id), userId)
        : false;

    // Employees who are not the creator may only flip the status of tasks
    // they are assigned to or of team tasks in their own teams.
    if (!canManage) {
      if (!isAssignee && !isTeamMember) {
        throw new Error('You do not have permission to update this task');
      }
      const payload: UpdateTaskData = { status: data.status };
      await this.taskRepository.update(taskId, payload);
      const refreshed = await this.taskRepository.findById(taskId);
      if (!refreshed) throw new Error('Task not found');
      return refreshed;
    }

    // Only managers can re-assign or move tasks into teams they don't belong
    // to; creators keep the rights they already had (self/their teams).
    if (data.team_id !== undefined && data.team_id !== null && !this.isManager(role)) {
      const team = await this.taskRepository.findTeam(Number(data.team_id));
      if (!team) throw new Error('Team not found');
      const member = await this.taskRepository.isTeamMember(Number(data.team_id), userId);
      if (!member) throw new Error('You can only move tasks into teams you are a member of');
    }
    if (
      data.assignee_id !== undefined &&
      data.assignee_id !== null &&
      Number(data.assignee_id) !== Number(userId) &&
      !this.isManager(role)
    ) {
      throw new Error('Only managers can assign tasks to other employees');
    }

    const payload: UpdateTaskData = { ...data };
    await this.taskRepository.update(taskId, payload);
    const refreshed = await this.taskRepository.findById(taskId);
    if (!refreshed) throw new Error('Task not found');

    // Assignment changed → notify the new assignee.
    if (
      data.assignee_id !== undefined &&
      data.assignee_id !== null &&
      Number(data.assignee_id) !== Number(task.assignee_id ?? null) &&
      Number(data.assignee_id) !== Number(userId)
    ) {
      await this.notifyAssigned(refreshed, userId);
    }
    return refreshed;
  }

  async deleteTask(taskId: number, userId: number, role: string): Promise<{ message: string }> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) throw new Error('Task not found');
    if (!this.isManager(role) && Number(task.created_by) !== Number(userId)) {
      throw new Error('You do not have permission to delete this task');
    }
    await this.taskRepository.delete(taskId);
    return { message: 'Task deleted successfully' };
  }

  private async notifyAssigned(task: TaskRow, actorId: number): Promise<void> {
    if (!task.assignee_id) return;
    const assigneeId = Number(task.assignee_id);
    try {
      const creator = await this.userRepository.findById(Number(task.created_by));
      const byLine = task.created_by
        ? `${creator?.first_name || ''} ${creator?.last_name || ''}`.trim()
        : 'Someone';
      const dueLine = task.due_date ? ` · due ${String(task.due_date).slice(0, 10)}` : '';

      const notify =
        !this.notificationPreferences ||
        (await this.notificationPreferences.isEnabled(assigneeId, 'tasks'));
      if (!notify) return;

      await this.notificationRepository.create({
        user_id: assigneeId,
        actor_id: actorId,
        type: 'task_assigned',
        title: 'New task assigned',
        message: `${task.title}${dueLine}`,
        data: { taskId: task.id, createdBy: byLine, dueDate: task.due_date },
      });
      sendToUser(assigneeId, {
        type: 'notification',
        data: {
          type: 'task_assigned',
          title: 'New task assigned',
          message: `${task.title}${dueLine}`,
          taskId: task.id,
        },
      });
    } catch (error) {
      // Notification failures must never break task assignment.
      console.error('[TaskService] Failed to notify assignee:', (error as Error).message);
    }
  }

  /**
   * Due-date alerts — polled by the server scheduler. Each assigned,
   * unfinished task gets one `task_deadline` notification once its due date
   * arrives (or has passed); deadline_reminded_at makes it idempotent.
   */
  async processDueTaskDeadlines(now: Date = new Date()): Promise<void> {
    const today = dateOnly(now);
    const due = await this.taskRepository.findUnremindedDueTasks(today);
    if (due.length === 0) return;

    for (const task of due) {
      try {
        const assigneeId = Number(task.assignee_id);
        const wantsNotifications =
          !this.notificationPreferences ||
          (await this.notificationPreferences.isEnabled(assigneeId, 'tasks'));
        if (wantsNotifications) {
          const isOverdue = task.due_date ? String(task.due_date).slice(0, 10) < today : false;
          const title = isOverdue ? 'Task overdue' : 'Task due today';
          const message = `${task.title}${isOverdue ? ' — was due earlier' : ''}`;
          await this.notificationRepository.create({
            user_id: assigneeId,
            actor_id: assigneeId,
            type: 'task_deadline',
            title,
            message,
            data: { taskId: task.id, dueDate: task.due_date },
          });
          sendToUser(assigneeId, {
            type: 'notification',
            data: { type: 'task_deadline', title, message, taskId: task.id },
          });
        }
        await this.taskRepository.markDeadlineReminded(task.id, now);
      } catch (error) {
        // Keep the scheduler moving; next tick will retry the rest.
        console.error('[TaskService] Deadline reminder failed:', (error as Error).message);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Task comments
  // -------------------------------------------------------------------------

  async addComment(taskId: number, userId: number, content: string): Promise<TaskCommentRow> {
    const trimmed = (content || '').trim();
    if (!trimmed) throw new Error('Comment content is required');
    const task = await this.taskRepository.findById(taskId);
    if (!task) throw new Error('Task not found');
    await this.assertCanViewTask(task, userId);

    const commentId = await this.taskRepository.createComment({
      task_id: taskId,
      user_id: userId,
      content: trimmed,
    });
    const comment = await this.taskRepository.findCommentById(commentId);
    if (!comment) throw new Error('Failed to create comment');
    return comment;
  }

  async listComments(taskId: number, userId: number): Promise<TaskCommentRow[]> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) throw new Error('Task not found');
    await this.assertCanViewTask(task, userId);
    return this.taskRepository.findCommentsByTask(taskId);
  }

  async deleteComment(commentId: number, userId: number, role: string): Promise<boolean> {
    const comment = await this.taskRepository.findCommentById(commentId);
    if (!comment) throw new Error('Comment not found');
    // The author may delete their own comment; managers may delete any in
    // their company.
    if (!this.isManager(role) && Number(comment.user_id) !== Number(userId)) {
      throw new Error('You do not have permission to delete this comment');
    }
    return this.taskRepository.deleteComment(commentId);
  }

  // -------------------------------------------------------------------------
  // Task attachments
  // -------------------------------------------------------------------------

  async addAttachment(
    taskId: number,
    userId: number,
    file: {
      file_name: string;
      file_url: string;
      file_type?: string | null;
      file_size?: number | null;
    },
  ): Promise<TaskAttachmentRow> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) throw new Error('Task not found');
    await this.assertCanViewTask(task, userId);

    const attachmentId = await this.taskRepository.createAttachment({
      task_id: taskId,
      uploaded_by: userId,
      file_name: file.file_name,
      file_url: file.file_url,
      file_type: file.file_type ?? null,
      file_size: file.file_size ?? null,
    });
    const attachment = await this.taskRepository.findAttachmentById(attachmentId);
    if (!attachment) throw new Error('Failed to attach file');
    return attachment;
  }

  async listAttachments(taskId: number, userId: number): Promise<TaskAttachmentRow[]> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) throw new Error('Task not found');
    await this.assertCanViewTask(task, userId);
    return this.taskRepository.findAttachmentsByTask(taskId);
  }

  async deleteAttachment(
    attachmentId: number,
    userId: number,
    role: string,
  ): Promise<{ deleted: boolean; file_url?: string }> {
    const attachment = await this.taskRepository.findAttachmentById(attachmentId);
    if (!attachment) throw new Error('Attachment not found');
    if (!this.isManager(role) && Number(attachment.uploaded_by) !== Number(userId)) {
      throw new Error('You do not have permission to delete this attachment');
    }
    const deleted = await this.taskRepository.deleteAttachment(attachmentId);
    return { deleted, file_url: attachment.file_url };
  }
}
