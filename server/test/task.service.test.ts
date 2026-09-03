'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TaskService } from '../src/services/Task.service';
import type { TaskRepository } from '../src/repositories/taskRepository';
import type { NotificationRepository } from '../src/repositories/notificationRepository';
import type { UserRepository } from '../src/repositories/userRepository';

// ---------------------------------------------------------------------------
// In-memory stubs
// ---------------------------------------------------------------------------

const dateNDays = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const makeTaskRepo = (
  initial: Array<Record<string, any>> = [],
  opts: { memberships?: Array<{ team_id: number; user_id: number }>; teams?: Array<Record<string, any>> } = {},
) => {
  let nextId = 100;
  const tasks: Array<Record<string, any>> = initial.map((t) => ({ ...t }));
  const memberships = (opts.memberships || []).map((m) => ({ ...m }));
  const teams = (opts.teams || []).map((t) => ({ ...t }));
  const comments: Array<Record<string, any>> = [];
  const attachments: Array<Record<string, any>> = [];
  let nextCommentId = 1;
  let nextAttachmentId = 1;

  const visibleFilter = (t: Record<string, any>, userId: number) =>
    Number(t.assignee_id) === userId ||
    Number(t.created_by) === userId ||
    memberships.some((m) => m.user_id === userId && m.team_id === Number(t.team_id));

  const applyFilters = (list: Array<Record<string, any>>, filters: Record<string, any>) => {
    let result = list.filter((t) => Number(t.company_id) === Number(filters.companyId));
    if (filters.assigneeId !== undefined) result = result.filter((t) => Number(t.assignee_id) === Number(filters.assigneeId));
    if (filters.createdById !== undefined) result = result.filter((t) => Number(t.created_by) === Number(filters.createdById));
    if (filters.teamId !== undefined) {
      if (Number(filters.teamId) === 0) result = result.filter((t) => t.team_id == null);
      else result = result.filter((t) => Number(t.team_id) === Number(filters.teamId));
    }
    if (filters.status) result = result.filter((t) => t.status === filters.status);
    if (filters.priority) result = result.filter((t) => t.priority === filters.priority);
    if (filters.search) result = result.filter((t) => String(t.title).includes(filters.search));
    return result;
  };

  return {
    tasks,
    comments,
    attachments,
    memberships,
    teams,
    create: async (data: Record<string, any>) => {
      const id = nextId++;
      tasks.push({
        id,
        company_id: data.company_id,
        team_id: data.team_id ?? null,
        created_by: data.created_by,
        assignee_id: data.assignee_id ?? null,
        title: data.title,
        description: data.description ?? null,
        due_date: data.due_date ?? null,
        priority: data.priority || 'medium',
        status: 'open',
        completed_at: null,
        deadline_reminded_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      return id;
    },
    findById: async (id: number) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return null;
      const team = teams.find((tm) => tm.id === Number(t.team_id));
      return {
        ...t,
        team_name: team?.name ?? null,
        assignee_first_name: null,
        assignee_last_name: null,
        creator_first_name: null,
        creator_last_name: null,
      };
    },
    findAll: async (filters: Record<string, any>) => {
      const list = applyFilters(tasks, filters);
      return { tasks: list.map((t) => ({ ...t })), total: list.length };
    },
    findAllVisibleToUser: async (filters: Record<string, any>, userId: number) => {
      const list = applyFilters(
        tasks.filter((t) => visibleFilter(t, userId)),
        filters,
      );
      return { tasks: list.map((t) => ({ ...t })), total: list.length };
    },
    findTeam: async (teamId: number) => {
      const team = teams.find((tm) => Number(tm.id) === Number(teamId));
      return team ? { id: Number(team.id), company_id: Number(team.company_id), name: String(team.name || '') } : null;
    },
    isTeamMember: async (teamId: number, userId: number) =>
      memberships.some((m) => Number(m.team_id) === Number(teamId) && Number(m.user_id) === Number(userId)),
    update: async (id: number, data: Record<string, any>) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return false;
      Object.assign(t, data);
      if (data.status === 'completed') t.completed_at = new Date();
      if (data.status && data.status !== 'completed') t.completed_at = null;
      return true;
    },
    delete: async (id: number) => {
      const i = tasks.findIndex((x) => x.id === id);
      if (i < 0) return false;
      tasks.splice(i, 1);
      return true;
    },
    markDeadlineReminded: async (id: number, at: Date) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return false;
      t.deadline_reminded_at = at;
      return true;
    },
    findUnremindedDueTasks: async (cutoff: string) =>
      tasks
        .filter((t) => t.status !== 'completed' && t.assignee_id != null && t.due_date != null && String(t.due_date) <= cutoff && t.deadline_reminded_at == null)
        .map((t) => ({ id: t.id, assignee_id: t.assignee_id, title: t.title, due_date: t.due_date })),
    // task_comments
    createComment: async (data: Record<string, any>) => {
      const id = nextCommentId++;
      comments.push({
        id,
        task_id: data.task_id,
        user_id: data.user_id,
        content: data.content,
        created_at: new Date(),
        updated_at: new Date(),
      });
      return id;
    },
    findCommentById: async (id: number) => {
      const c = comments.find((x) => x.id === id);
      return c
        ? {
            ...c,
            author_first_name: null,
            author_last_name: null,
            author_email: null,
            author_profile_picture: null,
          }
        : null;
    },
    findCommentsByTask: async (taskId: number) =>
      comments
        .filter((c) => Number(c.task_id) === Number(taskId))
        .map((c) => ({
          ...c,
          author_first_name: null,
          author_last_name: null,
          author_email: null,
          author_profile_picture: null,
        })),
    deleteComment: async (id: number) => {
      const i = comments.findIndex((x) => x.id === id);
      if (i < 0) return false;
      comments.splice(i, 1);
      return true;
    },
    // task_attachments
    createAttachment: async (data: Record<string, any>) => {
      const id = nextAttachmentId++;
      attachments.push({
        id,
        task_id: data.task_id,
        uploaded_by: data.uploaded_by,
        file_name: data.file_name,
        file_url: data.file_url,
        file_type: data.file_type ?? null,
        file_size: data.file_size ?? null,
        created_at: new Date(),
      });
      return id;
    },
    findAttachmentById: async (id: number) => {
      const a = attachments.find((x) => x.id === id);
      return a
        ? { ...a, uploader_first_name: null, uploader_last_name: null, uploader_email: null }
        : null;
    },
    findAttachmentsByTask: async (taskId: number) =>
      attachments
        .filter((a) => Number(a.task_id) === Number(taskId))
        .map((a) => ({ ...a, uploader_first_name: null, uploader_last_name: null, uploader_email: null })),
    deleteAttachment: async (id: number) => {
      const i = attachments.findIndex((x) => x.id === id);
      if (i < 0) return false;
      attachments.splice(i, 1);
      return true;
    },
  };
};

const makeUserRepo = (users: Array<Record<string, any>>) => ({
  findById: async (id: number) => users.find((u) => u.id === id) || null,
});

const makeNotificationRepo = () => {
  const rows: Array<Record<string, any>> = [];
  return {
    rows,
    create: async (data: Record<string, any>) => {
      rows.push({ id: rows.length + 1, ...data });
      return rows.length;
    },
  };
};

const makePrefs = (disabled: string[] = [], userId = 3) => ({
  isEnabled: async (uid: number, category: string) =>
    !(Number(uid) === userId && disabled.includes(category)),
  filterEnabled: async (category: string, ids: number[]) =>
    ids.filter((id) => !(Number(id) === userId && disabled.includes(category))),
});

const COMPANY = 1;
const MANAGER = { id: 2, company_id: COMPANY, role: 'manager' };
const EMPLOYEE = { id: 3, company_id: COMPANY, role: 'employee' };
const OTHER_EMPLOYEE = { id: 4, company_id: COMPANY, role: 'employee' };

const makeContext = (opts: {
  users?: Array<Record<string, any>>;
  tasks?: Array<Record<string, any>>;
  disabledCategories?: string[];
  memberships?: Array<{ team_id: number; user_id: number }>;
  teams?: Array<Record<string, any>>;
} = {}) => {
  const taskRepo = makeTaskRepo(opts.tasks || [], {
    memberships: opts.memberships,
    teams: opts.teams,
  });
  const userRepo = makeUserRepo(opts.users || [MANAGER, EMPLOYEE, OTHER_EMPLOYEE]);
  const notificationRepo = makeNotificationRepo();
  const prefs = makePrefs(opts.disabledCategories || [], 3);
  const service = new TaskService(
    taskRepo as unknown as TaskRepository,
    notificationRepo as unknown as NotificationRepository,
    userRepo as unknown as UserRepository,
    prefs as unknown as never,
  );
  return { service, taskRepo, notificationRepo, userRepo, prefs };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskService', () => {
  it('a manager can assign a task to an employee (creates a notification)', async () => {
    const ctx = makeContext();
    const task = await ctx.service.createTask({
      company_id: COMPANY,
      created_by: MANAGER.id,
      role: 'manager',
      title: 'Ship the onboarding flow',
      description: 'QA + release',
      assignee_id: EMPLOYEE.id,
      due_date: dateNDays(5),
      priority: 'high',
    });
    assert.equal(task.title, 'Ship the onboarding flow');
    assert.equal(task.assignee_id, EMPLOYEE.id);
    assert.equal(ctx.taskRepo.tasks.length, 1);
    const notif = ctx.notificationRepo.rows.find((r) => r.type === 'task_assigned');
    assert.ok(notif);
    assert.equal(notif.user_id, EMPLOYEE.id);
    assert.equal(notif.message, 'Ship the onboarding flow · due ' + dateNDays(5));
  });

  it('an employee cannot assign a task to another employee', async () => {
    const ctx = makeContext();
    await assert.rejects(
      ctx.service.createTask({
        company_id: COMPANY,
        created_by: EMPLOYEE.id,
        role: 'employee',
        title: 'Steal the flag',
        assignee_id: OTHER_EMPLOYEE.id,
      }),
      /Only managers can assign tasks to other employees/,
    );
  });

  it('an employee can create a task for themselves (no notification)', async () => {
    const ctx = makeContext();
    const task = await ctx.service.createTask({
      company_id: COMPANY,
      created_by: EMPLOYEE.id,
      role: 'employee',
      title: 'My own todo',
      assignee_id: EMPLOYEE.id,
      due_date: dateNDays(2),
    });
    assert.equal(task.assignee_id, EMPLOYEE.id);
    assert.equal(ctx.notificationRepo.rows.length, 0);
  });

  it('no assignment notification is created when the assignee muted tasks', async () => {
    const ctx = makeContext({ disabledCategories: ['tasks'] });
    await ctx.service.createTask({
      company_id: COMPANY,
      created_by: MANAGER.id,
      role: 'manager',
      title: 'Quiet assignment',
      assignee_id: EMPLOYEE.id,
    });
    assert.equal(ctx.notificationRepo.rows.length, 0);
  });

  it('employees only list their own tasks; managers list everything', async () => {
    const tasks = [
      { id: 1, company_id: COMPANY, team_id: null, created_by: MANAGER.id, assignee_id: EMPLOYEE.id, title: 'To employee', status: 'open', priority: 'medium', due_date: dateNDays(1) },
      { id: 2, company_id: COMPANY, team_id: null, created_by: EMPLOYEE.id, assignee_id: null, title: 'Personal', status: 'open', priority: 'medium', due_date: null },
      { id: 3, company_id: COMPANY, team_id: null, created_by: MANAGER.id, assignee_id: OTHER_EMPLOYEE.id, title: 'Someone else', status: 'open', priority: 'medium', due_date: null },
    ];
    const ctx = makeContext({ tasks });

    const asEmployee = await ctx.service.listTasks(EMPLOYEE.id, 'employee', COMPANY);
    assert.deepEqual(asEmployee.tasks.map((t) => t.title).sort(), ['Personal', 'To employee']);

    const asManager = await ctx.service.listTasks(MANAGER.id, 'manager', COMPANY);
    assert.equal(asManager.tasks.length, 3);
  });

  it('marks a task as overdue when its due date passed without completion', async () => {
    const ctx = makeContext({
      tasks: [
        { id: 9, company_id: COMPANY, team_id: null, created_by: MANAGER.id, assignee_id: EMPLOYEE.id, title: 'Late task', status: 'in_progress', priority: 'high', due_date: dateNDays(-2) },
      ],
    });
    const result = await ctx.service.listTasks(MANAGER.id, 'manager', COMPANY);
    assert.equal(result.tasks[0].is_overdue, true);
  });

  it('allows the assignee to flip their own status; rejects a stranger employee', async () => {
    const ctx = makeContext({
      tasks: [
        { id: 1, company_id: COMPANY, team_id: null, created_by: MANAGER.id, assignee_id: EMPLOYEE.id, title: 'Do it', status: 'open', priority: 'medium', due_date: null },
      ],
    });
    const updated = await ctx.service.updateTask(1, EMPLOYEE.id, 'employee', { status: 'completed' });
    assert.equal(updated.status, 'completed');

    await assert.rejects(
      ctx.service.updateTask(1, OTHER_EMPLOYEE.id, 'employee', { status: 'open' }),
      /do not have permission/,
    );
  });

  it('rejects invalid due dates and priorities', async () => {
    const ctx = makeContext();
    await assert.rejects(
      ctx.service.createTask({
        company_id: COMPANY,
        created_by: MANAGER.id,
        role: 'manager',
        title: 'Bad date',
        due_date: '10/10/2026',
      }),
      /YYYY-MM-DD/,
    );
    await assert.rejects(
      ctx.service.createTask({
        company_id: COMPANY,
        created_by: MANAGER.id,
        role: 'manager',
        title: 'Bad priority',
        priority: 'urgent' as never,
      }),
      /priority must be/,
    );
  });

  it('only the creator or a manager can delete a task', async () => {
    const ctx = makeContext({
      tasks: [
        { id: 1, company_id: COMPANY, team_id: null, created_by: MANAGER.id, assignee_id: EMPLOYEE.id, title: 'Mine', status: 'open', priority: 'medium', due_date: null },
        { id: 2, company_id: COMPANY, team_id: null, created_by: EMPLOYEE.id, assignee_id: null, title: 'Owned', status: 'open', priority: 'medium', due_date: null },
      ],
    });
    await assert.rejects(ctx.service.deleteTask(1, EMPLOYEE.id, 'employee'), /do not have permission/);
    // The creator can delete their own task; the manager can delete anything.
    await ctx.service.deleteTask(2, EMPLOYEE.id, 'employee');
    await ctx.service.deleteTask(1, MANAGER.id, 'manager');
    assert.equal(ctx.taskRepo.tasks.length, 0);
  });

  it('deadline reminders notify once and consume muted users without rows', async () => {
    const ctx = makeContext({
      users: [MANAGER, EMPLOYEE, OTHER_EMPLOYEE],
      disabledCategories: ['tasks'],
      tasks: [
        { id: 1, company_id: COMPANY, team_id: null, created_by: MANAGER.id, assignee_id: OTHER_EMPLOYEE.id, title: 'Loud deadline', status: 'open', priority: 'high', due_date: dateNDays(0), deadline_reminded_at: null },
        { id: 2, company_id: COMPANY, team_id: null, created_by: MANAGER.id, assignee_id: EMPLOYEE.id, title: 'Quiet deadline', status: 'open', priority: 'high', due_date: dateNDays(-1), deadline_reminded_at: null },
      ],
    });
    await ctx.service.processDueTaskDeadlines(new Date());
    // Only the non-muted assignee gets a notification.
    assert.equal(ctx.notificationRepo.rows.length, 1);
    assert.equal(ctx.notificationRepo.rows[0].type, 'task_deadline');
    assert.equal(ctx.notificationRepo.rows[0].user_id, OTHER_EMPLOYEE.id);
    assert.equal(ctx.notificationRepo.rows[0].title, 'Task due today');
    // Both reminders were consumed (idempotent).
    assert.ok(ctx.taskRepo.tasks.every((t) => t.deadline_reminded_at != null));
    await ctx.service.processDueTaskDeadlines(new Date());
    assert.equal(ctx.notificationRepo.rows.length, 1);
  });

  // -------------------------------------------------------------------------
  // Team tasks (migration 021)
  // -------------------------------------------------------------------------

  const TEAM_A = { id: 10, company_id: COMPANY, name: 'Design' };
  const TEAM_B = { id: 11, company_id: COMPANY, name: 'Eng' };
  const OTHER_COMPANY_TEAM = { id: 99, company_id: 7, name: 'Alien' };

  it('a manager can create a team task assigned to a team member', async () => {
    const ctx = makeContext({ teams: [TEAM_A] });
    const task = await ctx.service.createTask({
      company_id: COMPANY,
      created_by: MANAGER.id,
      role: 'manager',
      team_id: TEAM_A.id,
      title: 'Design the new logo',
      assignee_id: EMPLOYEE.id,
    });
    assert.equal(task.team_id, TEAM_A.id);
    assert.equal(task.title, 'Design the new logo');
    assert.ok(ctx.notificationRepo.rows.some((r) => r.type === 'task_assigned'));
  });

  it('an employee can create a task inside their own team but not a foreign team', async () => {
    const ctx = makeContext({
      teams: [TEAM_A, TEAM_B],
      memberships: [{ team_id: TEAM_A.id, user_id: EMPLOYEE.id }],
    });
    const ok = await ctx.service.createTask({
      company_id: COMPANY,
      created_by: EMPLOYEE.id,
      role: 'employee',
      team_id: TEAM_A.id,
      title: 'Team chore',
      assignee_id: EMPLOYEE.id,
    });
    assert.equal(ok.team_id, TEAM_A.id);

    await assert.rejects(
      ctx.service.createTask({
        company_id: COMPANY,
        created_by: EMPLOYEE.id,
        role: 'employee',
        team_id: TEAM_B.id,
        title: 'Sneaky',
      }),
      /only create tasks in teams you are a member of/,
    );
  });

  it('rejects creating a task in a team of another company', async () => {
    const ctx = makeContext({ teams: [OTHER_COMPANY_TEAM] });
    await assert.rejects(
      ctx.service.createTask({
        company_id: COMPANY,
        created_by: MANAGER.id,
        role: 'manager',
        team_id: OTHER_COMPANY_TEAM.id,
        title: 'Cross-company',
      }),
      /teams of your company/,
    );
  });

  it('employees see team tasks only when they belong to the team', async () => {
    const ctx = makeContext({
      teams: [TEAM_A],
      memberships: [{ team_id: TEAM_A.id, user_id: EMPLOYEE.id }],
      tasks: [
        { id: 21, company_id: COMPANY, team_id: TEAM_A.id, created_by: MANAGER.id, assignee_id: null, title: 'Team backlog item', status: 'open', priority: 'low', due_date: null },
        { id: 22, company_id: COMPANY, team_id: TEAM_A.id, created_by: MANAGER.id, assignee_id: OTHER_EMPLOYEE.id, title: 'Someone else assigned', status: 'open', priority: 'medium', due_date: null },
      ],
    });
    const member = await ctx.service.listTasks(EMPLOYEE.id, 'employee', COMPANY);
    assert.ok(member.tasks.some((t) => t.title === 'Team backlog item'));

    const outsider = await ctx.service.listTasks(OTHER_EMPLOYEE.id, 'employee', COMPANY);
    assert.ok(!outsider.tasks.some((t) => t.title === 'Team backlog item'));
    assert.ok(outsider.tasks.some((t) => t.title === 'Someone else assigned'));
  });

  it('a team member can move a team task between statuses; a manager can re-assign it', async () => {
    const ctx = makeContext({
      teams: [TEAM_A],
      memberships: [
        { team_id: TEAM_A.id, user_id: EMPLOYEE.id },
        { team_id: TEAM_A.id, user_id: OTHER_EMPLOYEE.id },
      ],
      tasks: [
        { id: 31, company_id: COMPANY, team_id: TEAM_A.id, created_by: MANAGER.id, assignee_id: null, title: 'Shared card', status: 'open', priority: 'medium', due_date: null },
      ],
    });
    const moved = await ctx.service.updateTask(31, EMPLOYEE.id, 'employee', { status: 'in_progress' });
    assert.equal(moved.status, 'in_progress');

    // Team members may only flip the status — field changes are not applied
    // (the payload is restricted to { status }).
    const attempted = await ctx.service.updateTask(31, EMPLOYEE.id, 'employee', {
      team_id: TEAM_B.id,
      assignee_id: OTHER_EMPLOYEE.id,
      status: 'open',
    });
    assert.equal(attempted.team_id, TEAM_A.id);

    const reassigned = await ctx.service.updateTask(31, MANAGER.id, 'manager', { assignee_id: OTHER_EMPLOYEE.id });
    assert.equal(reassigned.assignee_id, OTHER_EMPLOYEE.id);
  });

  it('priority + team filters work for list queries', async () => {
    const ctx = makeContext({
      tasks: [
        { id: 41, company_id: COMPANY, team_id: null, created_by: MANAGER.id, assignee_id: null, title: 'High one', status: 'open', priority: 'high', due_date: null },
        { id: 42, company_id: COMPANY, team_id: null, created_by: MANAGER.id, assignee_id: null, title: 'Low one', status: 'open', priority: 'low', due_date: null },
      ],
    });
    const high = await ctx.service.listTasks(MANAGER.id, 'manager', COMPANY, { priority: 'high' });
    assert.deepEqual(high.tasks.map((t) => t.title), ['High one']);
  });

  // -------------------------------------------------------------------------
  // Comments (migration 021)
  // -------------------------------------------------------------------------

  it('assignee/creator/team members may comment; strangers are rejected', async () => {
    const ctx = makeContext({
      teams: [TEAM_A],
      memberships: [{ team_id: TEAM_A.id, user_id: EMPLOYEE.id }],
      tasks: [
        { id: 51, company_id: COMPANY, team_id: null, created_by: MANAGER.id, assignee_id: EMPLOYEE.id, title: 'T', status: 'open', priority: 'medium', due_date: null },
        { id: 52, company_id: COMPANY, team_id: TEAM_A.id, created_by: MANAGER.id, assignee_id: null, title: 'Team task', status: 'open', priority: 'medium', due_date: null },
      ],
    });
    const comment = await ctx.service.addComment(51, EMPLOYEE.id, 'Will do');
    assert.equal(comment.content, 'Will do');
    assert.equal(ctx.taskRepo.comments.length, 1);

    // Stranger cannot comment on someone else's personal task.
    await assert.rejects(
      ctx.service.addComment(51, OTHER_EMPLOYEE.id, 'Me too'),
      /do not have permission/,
    );
    // But a team member can comment on their team's task.
    await ctx.service.addComment(52, EMPLOYEE.id, 'Team note');
    assert.equal(ctx.taskRepo.comments.length, 2);

    const list = await ctx.service.listComments(52, EMPLOYEE.id);
    assert.equal(list.length, 1);
  });

  it('only the comment author or a manager can delete a comment', async () => {
    const ctx = makeContext({
      teams: [TEAM_A],
      memberships: [{ team_id: TEAM_A.id, user_id: EMPLOYEE.id }],
      tasks: [
        { id: 61, company_id: COMPANY, team_id: null, created_by: MANAGER.id, assignee_id: EMPLOYEE.id, title: 'T', status: 'open', priority: 'medium', due_date: null },
      ],
    });
    const comment = await ctx.service.addComment(61, EMPLOYEE.id, 'Keep this');
    await assert.rejects(
      ctx.service.deleteComment(comment.id, OTHER_EMPLOYEE.id, 'employee'),
      /do not have permission to delete/,
    );
    assert.equal(await ctx.service.deleteComment(comment.id, MANAGER.id, 'manager'), true);
    assert.equal(ctx.taskRepo.comments.length, 0);
  });

  // -------------------------------------------------------------------------
  // Attachments (migration 021)
  // -------------------------------------------------------------------------

  it('attachments are gated by task visibility; uploader or manager can delete', async () => {
    const ctx = makeContext({
      teams: [TEAM_A],
      memberships: [{ team_id: TEAM_A.id, user_id: EMPLOYEE.id }],
      tasks: [
        { id: 71, company_id: COMPANY, team_id: null, created_by: MANAGER.id, assignee_id: EMPLOYEE.id, title: 'T', status: 'open', priority: 'medium', due_date: null },
      ],
    });
    const attachment = await ctx.service.addAttachment(71, EMPLOYEE.id, {
      file_name: 'plan.pdf',
      file_url: '/uploads/plan.pdf',
      file_type: 'application/pdf',
      file_size: 100,
    });
    assert.equal(attachment.file_name, 'plan.pdf');

    // A stranger cannot attach.
    await assert.rejects(
      ctx.service.addAttachment(71, OTHER_EMPLOYEE.id, {
        file_name: 'x.pdf',
        file_url: '/uploads/x.pdf',
      }),
      /do not have permission/,
    );
    // Only uploader or a manager can delete.
    await assert.rejects(
      ctx.service.deleteAttachment(attachment.id, OTHER_EMPLOYEE.id, 'employee'),
      /do not have permission to delete/,
    );
    const list = await ctx.service.listAttachments(71, EMPLOYEE.id);
    assert.equal(list.length, 1);
    const result = await ctx.service.deleteAttachment(attachment.id, EMPLOYEE.id, 'employee');
    assert.equal(result.deleted, true);
  });
});
