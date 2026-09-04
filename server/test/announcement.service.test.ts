'use strict';

/**
 * AnnouncementService — announcements (SRS FR-24) with scoped targeting,
 * pinning, scheduling, and read confirmation.
 *   - title/content are required (trimmed)
 *   - department/team targets must exist in the company
 *   - immediate publishes notify the audience (minus the publisher)
 *   - future `scheduled_at` keeps the announcement unpublished until the
 *     scheduler flips it live
 *   - markRead / getReaders implement read confirmation
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AnnouncementService } from '../src/services/Announcement.service';
import type { AnnouncementRepository } from '../src/repositories/announcementRepository';
import type { NotificationRepository } from '../src/repositories/notificationRepository';
import type { UserRepository } from '../src/repositories/userRepository';
import type { AnnouncementRow, CreateNotificationData, UserRow } from '../src/types';

const announcementRepository = {
  findAll: async () => [] as AnnouncementRow[],
  findById: async () => null as AnnouncementRow | null,
  findByIdForUser: async () => null as AnnouncementRow | null,
  create: async () => 1,
  update: async () => true,
  delete: async () => true,
  departmentExists: async () => true,
  teamExists: async () => true,
  findRecipientUserIds: async () => [] as number[],
  countRecipients: async () => 0,
  markRead: async () => undefined,
  findReaders: async () => [],
  findDueScheduled: async () => [] as AnnouncementRow[],
  markPublished: async () => true,
};

const notificationRepository = {
  create: async () => 1,
};

const userRepository = {
  findCompanyUserIds: async () => [] as number[],
  findById: async () => null as UserRow | null,
};

const announcementService = new AnnouncementService(
  announcementRepository as unknown as AnnouncementRepository,
  notificationRepository as unknown as NotificationRepository,
  userRepository as unknown as UserRepository,
);

const makeUser = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: 5,
  company_id: 1,
  department_id: 1,
  manager_id: null,
  first_name: 'Dara',
  last_name: 'Sok',
  email: 'dara@kneachat.com',
  password: 'hash',
  role: 'manager',
  job_title: 'Engineering Manager',
  profile_picture: null,
  status: 'online',
  is_active: 1,
  last_seen_at: null,
  created_at: '2026-08-17T10:00:00Z',
  updated_at: '2026-08-17T10:00:00Z',
  ...overrides,
});

/** First argument passed to a mocked repository call (untyped tuple → any). */
const callArg = (calls: Array<{ arguments: unknown[] }>, index = 0): Record<string, unknown> =>
  (calls[index]?.arguments as unknown[])[0] as Record<string, unknown>;

const makeAnnouncement = (overrides: Partial<AnnouncementRow> = {}): AnnouncementRow => ({
  id: 1,
  company_id: 1,
  scope: 'company',
  department_id: null,
  team_id: null,
  is_pinned: 0,
  scheduled_at: null,
  is_published: 1,
  published_at: '2026-08-17T10:00:00Z',
  title: 'Office closed Friday',
  content: 'The office will be closed for maintenance on Friday.',
  created_by: 5,
  created_at: '2026-08-17T10:00:00Z',
  updated_at: '2026-08-17T10:00:00Z',
  read_count: 0,
  total_recipients: 4,
  is_read: 0,
  ...overrides,
});

describe('AnnouncementService.createAnnouncement', () => {
  it('creates an announcement with trimmed title/content (company scope by default)', async (t) => {
    t.mock.method(announcementRepository, 'create', async () => 9);
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement({ id: 9, title: 'Heads up' }));
    t.mock.method(announcementRepository, 'findByIdForUser', async () => makeAnnouncement({ id: 9, title: 'Heads up' }));
    t.mock.method(announcementRepository, 'findRecipientUserIds', async () => [5, 11]);
    t.mock.method(userRepository, 'findById', async () => makeUser());

    const announcement = await announcementService.createAnnouncement({
      company_id: 1,
      title: '  Heads up  ',
      content: '  Standup moved to 10:30  ',
      created_by: 5,
    });

    assert.equal(announcement.id, 9);
    assert.equal(announcement.title, 'Heads up');
  });

  it('rejects an empty title', async (t) => {
    const create = t.mock.method(announcementRepository, 'create', async () => 1);
    await assert.rejects(
      announcementService.createAnnouncement({
        company_id: 1,
        title: '   ',
        content: 'Hello',
        created_by: 5,
      }),
      /Announcement title is required/,
    );
    assert.equal(create.mock.calls.length, 0);
  });

  it('rejects empty content', async (t) => {
    const create = t.mock.method(announcementRepository, 'create', async () => 1);
    await assert.rejects(
      announcementService.createAnnouncement({
        company_id: 1,
        title: 'Heads up',
        content: '',
        created_by: 5,
      }),
      /Announcement content is required/,
    );
    assert.equal(create.mock.calls.length, 0);
  });

  it('requires a department target for department scope', async (t) => {
    t.mock.method(announcementRepository, 'departmentExists', async () => true);
    const create = t.mock.method(announcementRepository, 'create', async () => 1);
    await assert.rejects(
      announcementService.createAnnouncement({
        company_id: 1,
        title: 'Heads up',
        content: 'Hello',
        created_by: 5,
        scope: 'department',
        department_id: null,
      }),
      /A department is required for department announcements/,
    );
    assert.equal(create.mock.calls.length, 0);
  });

  it('rejects a department target outside the company', async (t) => {
    t.mock.method(announcementRepository, 'departmentExists', async () => false);
    const create = t.mock.method(announcementRepository, 'create', async () => 1);
    await assert.rejects(
      announcementService.createAnnouncement({
        company_id: 1,
        title: 'Heads up',
        content: 'Hello',
        created_by: 5,
        scope: 'department',
        department_id: 99,
      }),
      /Department not found in this company/,
    );
    assert.equal(create.mock.calls.length, 0);
  });

  it('rejects a team target outside the company', async (t) => {
    t.mock.method(announcementRepository, 'teamExists', async () => false);
    const create = t.mock.method(announcementRepository, 'create', async () => 1);
    await assert.rejects(
      announcementService.createAnnouncement({
        company_id: 1,
        title: 'Heads up',
        content: 'Hello',
        created_by: 5,
        scope: 'team',
        team_id: 99,
      }),
      /Team not found in this company/,
    );
    assert.equal(create.mock.calls.length, 0);
  });

  it('notifies every company user except the publisher', async (t) => {
    t.mock.method(announcementRepository, 'create', async () => 9);
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement({ id: 9 }));
    t.mock.method(announcementRepository, 'findByIdForUser', async () => makeAnnouncement({ id: 9 }));
    t.mock.method(announcementRepository, 'findRecipientUserIds', async () => [5, 11, 12, 13]);
    t.mock.method(userRepository, 'findById', async () => makeUser());
    const notify = t.mock.method(notificationRepository, 'create', async (_data: CreateNotificationData) => 1);

    await announcementService.createAnnouncement({
      company_id: 1,
      title: 'Heads up',
      content: 'Reminder: review the roadmap.',
      created_by: 5,
    });

    const created = notify.mock.calls
      .map((c) => c.arguments[0])
      .filter((n): n is CreateNotificationData => !!n);
    assert.equal(created.length, 3); // publisher (5) excluded
    assert.deepEqual(created.map((n) => n.user_id), [11, 12, 13]);
    assert.ok(created.every((n) => n.type === 'announcement'));
    assert.ok(created.every((n) => n.data && n.data.announcementId === 9));
  });

  it('notifies only the department for a department-scoped announcement', async (t) => {
    t.mock.method(announcementRepository, 'create', async () => 10);
    t.mock.method(announcementRepository, 'findById', async () =>
      makeAnnouncement({ id: 10, scope: 'department', department_id: 2 }));
    t.mock.method(announcementRepository, 'findByIdForUser', async () =>
      makeAnnouncement({ id: 10, scope: 'department', department_id: 2 }));
    t.mock.method(announcementRepository, 'findRecipientUserIds', async () => [5, 21, 22]);
    t.mock.method(announcementRepository, 'departmentExists', async () => true);
    t.mock.method(userRepository, 'findById', async () => makeUser());
    const notify = t.mock.method(notificationRepository, 'create', async (_data: CreateNotificationData) => 1);

    await announcementService.createAnnouncement({
      company_id: 1,
      title: 'Dept lunch',
      content: 'Marketing lunch on Friday.',
      created_by: 5,
      scope: 'department',
      department_id: 2,
    });

    const created = notify.mock.calls
      .map((c) => c.arguments[0])
      .filter((n): n is CreateNotificationData => !!n);
    assert.deepEqual(created.map((n) => n.user_id), [21, 22]);
  });

  it('notifies only team members for a team-scoped announcement', async (t) => {
    t.mock.method(announcementRepository, 'create', async () => 11);
    t.mock.method(announcementRepository, 'findById', async () =>
      makeAnnouncement({ id: 11, scope: 'team', team_id: 3 }));
    t.mock.method(announcementRepository, 'findByIdForUser', async () =>
      makeAnnouncement({ id: 11, scope: 'team', team_id: 3 }));
    t.mock.method(announcementRepository, 'findRecipientUserIds', async () => [5, 31, 32]);
    t.mock.method(announcementRepository, 'teamExists', async () => true);
    t.mock.method(userRepository, 'findById', async () => makeUser());
    const notify = t.mock.method(notificationRepository, 'create', async (_data: CreateNotificationData) => 1);

    await announcementService.createAnnouncement({
      company_id: 1,
      title: 'Team standup',
      content: 'Standup moved to 11:00.',
      created_by: 5,
      scope: 'team',
      team_id: 3,
    });

    const created = notify.mock.calls
      .map((c) => c.arguments[0])
      .filter((n): n is CreateNotificationData => !!n);
    assert.deepEqual(created.map((n) => n.user_id), [31, 32]);
  });

  it('keeps a future-scheduled announcement unpublished and sends no notifications', async (t) => {
    const create = t.mock.method(announcementRepository, 'create', async () => 12);
    t.mock.method(announcementRepository, 'findById', async () =>
      makeAnnouncement({ id: 12, is_published: 0, scheduled_at: '2026-09-10T09:00:00Z' }));
    t.mock.method(announcementRepository, 'findByIdForUser', async () =>
      makeAnnouncement({ id: 12, is_published: 0, scheduled_at: '2026-09-10T09:00:00Z' }));
    t.mock.method(userRepository, 'findById', async () => makeUser());
    const notify = t.mock.method(notificationRepository, 'create', async () => 1);

    const announcement = await announcementService.createAnnouncement({
      company_id: 1,
      title: 'Future news',
      content: 'Coming soon.',
      created_by: 5,
      scheduled_at: '2026-09-10T09:00:00Z',
    });

    const insertArgs = callArg(create.mock.calls);
    assert.equal(insertArgs.is_published, 0);
    assert.ok(insertArgs.scheduled_at);
    assert.equal(announcement.is_published, 0);
    assert.equal(notify.mock.calls.length, 0);
  });

  it('stores a pinned announcement with is_pinned = 1', async (t) => {
    const create = t.mock.method(announcementRepository, 'create', async () => 13);
    t.mock.method(announcementRepository, 'findById', async () =>
      makeAnnouncement({ id: 13, is_pinned: 1 }));
    t.mock.method(announcementRepository, 'findByIdForUser', async () =>
      makeAnnouncement({ id: 13, is_pinned: 1 }));
    t.mock.method(announcementRepository, 'findRecipientUserIds', async () => [5]);
    t.mock.method(userRepository, 'findById', async () => makeUser());

    await announcementService.createAnnouncement({
      company_id: 1,
      title: 'Important',
      content: 'Please read.',
      created_by: 5,
      is_pinned: true,
    });

    const insertArgs = callArg(create.mock.calls);
    assert.equal(insertArgs.is_pinned, 1);
  });

  it('still publishes even if notification creation fails', async (t) => {
    t.mock.method(announcementRepository, 'create', async () => 9);
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement({ id: 9 }));
    t.mock.method(announcementRepository, 'findByIdForUser', async () => makeAnnouncement({ id: 9 }));
    t.mock.method(announcementRepository, 'findRecipientUserIds', async () => [5, 11]);
    t.mock.method(userRepository, 'findById', async () => makeUser());
    t.mock.method(notificationRepository, 'create', async () => {
      throw new Error('db down');
    });

    const announcement = await announcementService.createAnnouncement({
      company_id: 1,
      title: 'Heads up',
      content: 'Reminder.',
      created_by: 5,
    });

    assert.equal(announcement.id, 9);
  });
});

describe('AnnouncementService.updateAnnouncement', () => {
  it('updates title, content and pin state', async (t) => {
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement());
    const update = t.mock.method(announcementRepository, 'update', async () => true);
    t.mock.method(announcementRepository, 'findByIdForUser', async () => makeAnnouncement({ title: 'Renamed', is_pinned: 1 }));
    t.mock.method(userRepository, 'findById', async () => makeUser());

    const announcement = await announcementService.updateAnnouncement(
      1,
      { title: 'Renamed', content: 'New body', is_pinned: true },
      5,
      1,
    );

    assert.deepEqual(update.mock.calls[0].arguments, [1, { title: 'Renamed', content: 'New body', is_pinned: 1 }]);
    assert.equal(announcement.title, 'Renamed');
  });

  it('rejects an empty title on update', async (t) => {
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement());
    const update = t.mock.method(announcementRepository, 'update', async () => true);
    await assert.rejects(
      announcementService.updateAnnouncement(1, { title: '' }, 5, 1),
      /Announcement title is required/,
    );
    assert.equal(update.mock.calls.length, 0);
  });

  it('throws when the announcement does not exist', async (t) => {
    t.mock.method(announcementRepository, 'findById', async () => null);
    await assert.rejects(
      announcementService.updateAnnouncement(99, { title: 'X' }, 5, 1),
      /Announcement not found/,
    );
  });

  it('throws when the announcement belongs to another company', async (t) => {
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement({ company_id: 2 }));
    await assert.rejects(
      announcementService.updateAnnouncement(1, { title: 'X' }, 5, 1),
      /Announcement not found/,
    );
  });

  it('ignores scheduled_at changes once the announcement is published', async (t) => {
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement({ is_published: 1 }));
    const update = t.mock.method(announcementRepository, 'update', async () => true);
    t.mock.method(announcementRepository, 'findByIdForUser', async () => makeAnnouncement());
    t.mock.method(userRepository, 'findById', async () => makeUser());

    await announcementService.updateAnnouncement(
      1,
      { scheduled_at: '2026-09-10T09:00:00Z' },
      5,
      1,
    );

    const updateArgs = (update.mock.calls[0]?.arguments as unknown[])[1] as Record<string, unknown>;
    assert.equal(updateArgs.scheduled_at, undefined);
  });

  it('publishes a draft immediately when its schedule is cleared', async (t) => {
    const draft = makeAnnouncement({ id: 8, is_published: 0, scheduled_at: '2026-09-10T09:00:00Z' });
    const published = makeAnnouncement({ id: 8, is_published: 1, scheduled_at: null, published_at: '2026-08-17T10:00:00Z' });
    t.mock.method(announcementRepository, 'findById', async () => draft);
    const update = t.mock.method(announcementRepository, 'update', async () => true);
    t.mock.method(announcementRepository, 'findByIdForUser', async () => published);
    t.mock.method(announcementRepository, 'findRecipientUserIds', async () => [5, 11, 12]);
    t.mock.method(userRepository, 'findById', async () => makeUser());
    const notify = t.mock.method(notificationRepository, 'create', async (_data: CreateNotificationData) => 1);

    const announcement = await announcementService.updateAnnouncement(8, { scheduled_at: null }, 5, 1);

    const updateArgs = (update.mock.calls[0]?.arguments as unknown[])[1] as Record<string, unknown>;
    assert.equal(updateArgs.is_published, 1);
    assert.equal(updateArgs.scheduled_at, null);
    assert.equal(announcement.is_published, 1);
    assert.equal(notify.mock.calls.length, 2); // publisher (5) excluded
  });
});

describe('AnnouncementService.deleteAnnouncement', () => {
  it('deletes an existing announcement', async (t) => {
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement());
    const del = t.mock.method(announcementRepository, 'delete', async () => true);

    const result = await announcementService.deleteAnnouncement(1, 1);

    assert.equal(del.mock.calls.length, 1);
    assert.equal(result.message, 'Announcement deleted successfully');
  });

  it('throws when the announcement does not exist', async (t) => {
    t.mock.method(announcementRepository, 'findById', async () => null);
    await assert.rejects(
      announcementService.deleteAnnouncement(99, 1),
      /Announcement not found/,
    );
  });
});

describe('AnnouncementService.getAnnouncements', () => {
  it('passes the viewer context so the repository can scope visibility', async (t) => {
    t.mock.method(userRepository, 'findById', async () => makeUser({ role: 'employee' }));
    const findAll = t.mock.method(announcementRepository, 'findAll', async () => [
      makeAnnouncement({ id: 1, title: 'A' }),
      makeAnnouncement({ id: 2, title: 'B' }),
    ]);

    const announcements = await announcementService.getAnnouncements(1, 5);

    assert.equal(findAll.mock.calls.length, 1);
    assert.deepEqual(findAll.mock.calls[0].arguments, [1, 5, 1, false]); // companyId, userId, departmentId, isManager
    assert.equal(announcements.length, 2);
  });

  it('marks managers so they see every announcement (incl. drafts)', async (t) => {
    t.mock.method(userRepository, 'findById', async () => makeUser({ role: 'admin' }));
    const findAll = t.mock.method(announcementRepository, 'findAll', async () => []);

    await announcementService.getAnnouncements(1, 5);

    assert.deepEqual(findAll.mock.calls[0].arguments, [1, 5, 1, true]);
  });
});

describe('AnnouncementService.markRead', () => {
  it('records the read and returns the enriched announcement', async (t) => {
    t.mock.method(userRepository, 'findById', async () => makeUser({ role: 'employee' }));
    t.mock.method(announcementRepository, 'findByIdForUser', async () =>
      makeAnnouncement({ read_count: 2, is_read: 1 }));
    const markRead = t.mock.method(announcementRepository, 'markRead', async () => undefined);

    const announcement = await announcementService.markRead(1, 5, 1);

    assert.equal(markRead.mock.calls.length, 1);
    assert.deepEqual(markRead.mock.calls[0].arguments, [1, 5]);
    assert.equal(announcement.is_read, 1);
  });

  it('rejects marking an unpublished draft as read', async (t) => {
    t.mock.method(userRepository, 'findById', async () => makeUser({ role: 'employee' }));
    t.mock.method(announcementRepository, 'findByIdForUser', async () =>
      makeAnnouncement({ is_published: 0 }));
    await assert.rejects(
      announcementService.markRead(1, 5, 1),
      /Announcement not found/,
    );
  });

  it('throws when the viewer cannot see the announcement', async (t) => {
    t.mock.method(userRepository, 'findById', async () => makeUser({ role: 'employee' }));
    t.mock.method(announcementRepository, 'findByIdForUser', async () => null);
    await assert.rejects(
      announcementService.markRead(99, 5, 1),
      /Announcement not found/,
    );
  });
});

describe('AnnouncementService.getReaders', () => {
  it('returns the reader list and audience size', async (t) => {
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement());
    t.mock.method(announcementRepository, 'findReaders', async () => [
      { id: 1, announcement_id: 1, user_id: 5, read_at: '2026-08-17T10:00:00Z', first_name: 'Dara', last_name: 'Sok' },
    ]);
    t.mock.method(announcementRepository, 'countRecipients', async () => 4);

    const result = await announcementService.getReaders(1, 1);

    assert.equal(result.total_recipients, 4);
    assert.equal(result.readers.length, 1);
    assert.equal(result.readers[0].user_id, 5);
  });

  it('throws when the announcement does not exist', async (t) => {
    t.mock.method(announcementRepository, 'findById', async () => null);
    await assert.rejects(
      announcementService.getReaders(99, 1),
      /Announcement not found/,
    );
  });
});

describe('AnnouncementService.processDueScheduledAnnouncements', () => {
  it('publishes due announcements, notifies recipients, and returns them', async (t) => {
    const due = makeAnnouncement({ id: 7, is_published: 0, scheduled_at: '2026-08-17T08:00:00Z' });
    t.mock.method(announcementRepository, 'findDueScheduled', async () => [due]);
    const markPublished = t.mock.method(announcementRepository, 'markPublished', async () => true);
    t.mock.method(announcementRepository, 'findById', async () => due);
    t.mock.method(announcementRepository, 'findRecipientUserIds', async () => [5, 11, 12]);
    const notify = t.mock.method(notificationRepository, 'create', async (_data: CreateNotificationData) => 1);

    const published = await announcementService.processDueScheduledAnnouncements(new Date('2026-08-17T10:00:00Z'));

    assert.deepEqual(markPublished.mock.calls[0].arguments.slice(0, 1), [7]);
    assert.equal(published.length, 1);
    assert.equal(published[0].id, 7);
    assert.equal(notify.mock.calls.length, 2); // publisher (5) excluded
  });

  it('skips announcements already published by another instance', async (t) => {
    t.mock.method(announcementRepository, 'findDueScheduled', async () => [
      makeAnnouncement({ id: 7, is_published: 0 }),
    ]);
    t.mock.method(announcementRepository, 'markPublished', async () => false);
    const notify = t.mock.method(notificationRepository, 'create', async () => 1);

    const published = await announcementService.processDueScheduledAnnouncements(new Date());

    assert.equal(published.length, 0);
    assert.equal(notify.mock.calls.length, 0);
  });

  it('does nothing when nothing is due', async (t) => {
    t.mock.method(announcementRepository, 'findDueScheduled', async () => []);
    const published = await announcementService.processDueScheduledAnnouncements(new Date());
    assert.equal(published.length, 0);
  });
});