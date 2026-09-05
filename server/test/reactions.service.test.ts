import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationService } from '../src/services/Notification.service';
import { AnnouncementService } from '../src/services/Announcement.service';
import { TaskService } from '../src/services/Task.service';
import type { NotificationRepository } from '../src/repositories/notificationRepository';
import type { MessageRepository } from '../src/repositories/messageRepository';
import type { AnnouncementRepository } from '../src/repositories/announcementRepository';
import type { TaskRepository } from '../src/repositories/taskRepository';
import type { UserRepository } from '../src/repositories/userRepository';
import type { AnnouncementRow, NotificationRow, TaskRow } from '../src/types';

// ---------------------------------------------------------------------------
// NotificationService enrichment
// ---------------------------------------------------------------------------

const notifRow = (overrides: Partial<NotificationRow>): NotificationRow => ({
  id: 1,
  user_id: 2,
  actor_id: 3,
  type: 'mention',
  title: 't',
  message: 'm',
  data: JSON.stringify({ conversationId: 7, messageId: 42 }),
  is_read: 0,
  created_at: new Date(),
  ...overrides,
});

const makeEnrichmentHarness = () => {
  const rows = [
    notifRow({ id: 1, type: 'mention', data: JSON.stringify({ conversationId: 7, messageId: 42 }) }),
    notifRow({ id: 2, type: 'new_message', data: JSON.stringify({ conversationId: 7, messageId: 42 }) }),
    notifRow({ id: 3, type: 'announcement', data: JSON.stringify({ announcementId: 99 }) }),
    notifRow({ id: 4, type: 'task_assigned', data: JSON.stringify({ taskId: 12 }) }),
    notifRow({ id: 5, type: 'missed_call', data: JSON.stringify({ callerUserId: 3 }) }),
    notifRow({ id: 6, type: 'announcement', data: 'not-json {' }),
  ];
  const notificationRepo = {
    findAll: async () => rows,
    getUnreadCount: async () => 3,
  } as unknown as NotificationRepository;
  const messageRepo = {
    findReactionsByMessageIds: async (ids: number[]) =>
      ids.map((message_id) => ({ id: 1, message_id, user_id: 3, reaction: '👍' })),
  } as unknown as MessageRepository;
  const announcementRepo = {
    findReactionsByAnnouncementIds: async (ids: number[]) =>
      ids.map((announcement_id) => ({ id: 2, announcement_id, user_id: 3, reaction: '❤️' })),
  } as unknown as AnnouncementRepository;
  const taskRepo = {
    findReactionsByTaskIds: async (ids: number[]) =>
      ids.map((task_id) => ({ id: 3, task_id, user_id: 3, reaction: '🎉' })),
  } as unknown as TaskRepository;
  const service = new NotificationService(notificationRepo, messageRepo, announcementRepo, taskRepo);
  return { service, rows };
};

test('NotificationService attaches reactions for message/announcement/task targets', async () => {
  const { service, rows } = makeEnrichmentHarness();
  const { notifications } = await service.getNotifications(2, { limit: 20 });

  const byType = (type: string) => notifications.find((n) => n.type === type)!;
  assert.deepEqual(byType('mention').reactions, [
    { id: 1, message_id: 42, user_id: 3, reaction: '👍' },
  ]);
  assert.deepEqual(byType('new_message').reactions, [
    { id: 1, message_id: 42, user_id: 3, reaction: '👍' },
  ]);
  assert.deepEqual(byType('announcement').reactions, [
    { id: 2, announcement_id: 99, user_id: 3, reaction: '❤️' },
  ]);
  assert.deepEqual(byType('task_assigned').reactions, [
    { id: 3, task_id: 12, user_id: 3, reaction: '🎉' },
  ]);
  // Non-reaction targets and unparseable data keep no reactions field.
  assert.equal(byType('missed_call').reactions, undefined);
  assert.equal(
    rows.find((r) => r.id === 6)!.reactions,
    undefined,
  );
});

test('NotificationService skips queries when enrichment repositories are absent', async () => {
  const notificationRepo = {
    findAll: async () => [notifRow({ type: 'announcement', data: JSON.stringify({ announcementId: 99 }) })],
    getUnreadCount: async () => 0,
  } as unknown as NotificationRepository;
  const service = new NotificationService(notificationRepo);
  const { notifications } = await service.getNotifications(2);
  assert.equal(notifications[0].reactions, undefined);
});

// ---------------------------------------------------------------------------
// AnnouncementService / TaskService reaction endpoints
// ---------------------------------------------------------------------------

const announcementOf = (overrides: Partial<AnnouncementRow> = {}): AnnouncementRow =>
  ({
    id: 99,
    company_id: 1,
    scope: 'company',
    department_id: null,
    team_id: null,
    is_pinned: 0,
    scheduled_at: null,
    is_published: 1,
    published_at: null,
    title: 'Lunch schedule',
    content: 'Free food on Friday',
    created_by: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }) as AnnouncementRow;

const taskOf = (overrides: Partial<TaskRow> = {}): TaskRow =>
  ({
    id: 12,
    company_id: 1,
    team_id: null,
    created_by: 1,
    assignee_id: 2,
    title: 'Ship the release',
    description: null,
    due_date: null,
    priority: 'high',
    status: 'open',
    completed_at: null,
    deadline_reminded_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }) as TaskRow;

const userRepoOf = (role: string, companyId = 1) =>
  ({
    findById: async () => ({ role, company_id: companyId, department_id: null }),
  }) as unknown as UserRepository;

test('AnnouncementService.addReaction adds + returns the fresh list', async () => {
  const announcementRepo = {
    findByIdForUser: async () => announcementOf(),
    findReactionsByAnnouncementIds: async (ids: number[]) =>
      ids.map((announcement_id) => ({ id: 5, announcement_id, user_id: 2, reaction: '🔥' })),
    findReactions: async (announcementId: number) =>
      [{ id: 5, announcement_id: announcementId, user_id: 2, reaction: '🔥' }],
    addReaction: async () => {},
    findRecipientUserIds: async () => [],
  } as unknown as AnnouncementRepository;
  const service = new AnnouncementService(
    announcementRepo,
    {} as unknown as NotificationRepository,
    userRepoOf('employee'),
  );
  const reactions = await service.addReaction(99, 1, 2, '🔥');
  assert.equal(reactions.length, 1);
  assert.equal(reactions[0].reaction, '🔥');
});

test('AnnouncementService reactions are rejected on drafts', async () => {
  const announcementRepo = {
    findByIdForUser: async () => announcementOf({ is_published: 0 }),
    findReactionsByAnnouncementIds: async () => [],
  } as unknown as AnnouncementRepository;
  const service = new AnnouncementService(
    announcementRepo,
    {} as unknown as NotificationRepository,
    userRepoOf('employee'),
  );
  await assert.rejects(service.addReaction(99, 1, 2, '👍'), /Announcement not found/);
});

test('TaskService.addReaction allows managers and blocks outsiders', async () => {
  const taskRepoBase = {
    findById: async () => taskOf(),
    addReaction: async () => {},
    removeReaction: async () => true,
    findReactionsByTaskIds: async (ids: number[]) =>
      ids.map((task_id) => ({ id: 9, task_id, user_id: 1, reaction: '🎉' })),
    findReactions: async (taskId: number) =>
      [{ id: 9, task_id: taskId, user_id: 1, reaction: '🎉' }],
    findViewerUserIds: async () => [],
  };

  const managerService = new TaskService(
    taskRepoBase as unknown as TaskRepository,
    {} as unknown as NotificationRepository,
    userRepoOf('manager'),
  );
  const reactions = await managerService.addReaction(12, 1, '🎉');
  assert.equal(reactions.length, 1);
  assert.equal(reactions[0].task_id, 12);

  // An employee with no link to the task (not assignee/creator/team member).
  const outsiderService = new TaskService(
    taskRepoBase as unknown as TaskRepository,
    {} as unknown as NotificationRepository,
    userRepoOf('employee'),
  );
  await assert.rejects(
    outsiderService.addReaction(12, 5, '🎉'),
    /do not have permission/,
  );
});
