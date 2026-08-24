'use strict';

/**
 * AnnouncementService — company-wide announcements (SRS FR-24).
 *   - title/content are required (trimmed)
 *   - publishing creates an `announcement` notification for every company
 *     user except the publisher
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AnnouncementService } from '../src/services/Announcement.service';
import type { AnnouncementRepository } from '../src/repositories/announcementRepository';
import type { NotificationRepository } from '../src/repositories/notificationRepository';
import type { UserRepository } from '../src/repositories/userRepository';
import type { AnnouncementRow, CreateNotificationData } from '../src/types';

const announcementRepository = {
  findAll: async () => [] as AnnouncementRow[],
  findById: async () => null as AnnouncementRow | null,
  create: async () => 1,
  update: async () => true,
  delete: async () => true,
};

const notificationRepository = {
  create: async () => 1,
};

const userRepository = {
  findCompanyUserIds: async () => [] as number[],
};

const announcementService = new AnnouncementService(
  announcementRepository as unknown as AnnouncementRepository,
  notificationRepository as unknown as NotificationRepository,
  userRepository as unknown as UserRepository,
);

const makeAnnouncement = (overrides: Partial<AnnouncementRow> = {}): AnnouncementRow => ({
  id: 1,
  company_id: 1,
  title: 'Office closed Friday',
  content: 'The office will be closed for maintenance on Friday.',
  created_by: 5,
  created_at: '2026-08-17T10:00:00Z',
  updated_at: '2026-08-17T10:00:00Z',
  ...overrides,
});

describe('AnnouncementService.createAnnouncement', () => {
  it('creates an announcement with trimmed title/content', async (t) => {
    t.mock.method(announcementRepository, 'create', async () => 9);
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement({ id: 9, title: 'Heads up' }));

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

  it('notifies every company user except the publisher', async (t) => {
    t.mock.method(announcementRepository, 'create', async () => 9);
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement({ id: 9 }));
    t.mock.method(userRepository, 'findCompanyUserIds', async () => [5, 11, 12, 13]);
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

  it('still publishes even if notification creation fails', async (t) => {
    t.mock.method(announcementRepository, 'create', async () => 9);
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement({ id: 9 }));
    t.mock.method(userRepository, 'findCompanyUserIds', async () => [5, 11]);
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
  it('updates title and content', async (t) => {
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement());
    const update = t.mock.method(announcementRepository, 'update', async () => true);
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement({ title: 'Renamed' }));

    const announcement = await announcementService.updateAnnouncement(1, {
      title: 'Renamed',
      content: 'New body',
    });

    assert.deepEqual(update.mock.calls[0].arguments, [1, { title: 'Renamed', content: 'New body' }]);
    assert.equal(announcement.title, 'Renamed');
  });

  it('rejects an empty title on update', async (t) => {
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement());
    const update = t.mock.method(announcementRepository, 'update', async () => true);
    await assert.rejects(
      announcementService.updateAnnouncement(1, { title: '' }),
      /Announcement title is required/,
    );
    assert.equal(update.mock.calls.length, 0);
  });

  it('throws when the announcement does not exist', async (t) => {
    t.mock.method(announcementRepository, 'findById', async () => null);
    await assert.rejects(
      announcementService.updateAnnouncement(99, { title: 'X' }),
      /Announcement not found/,
    );
  });
});

describe('AnnouncementService.deleteAnnouncement', () => {
  it('deletes an existing announcement', async (t) => {
    t.mock.method(announcementRepository, 'findById', async () => makeAnnouncement());
    const del = t.mock.method(announcementRepository, 'delete', async () => true);

    const result = await announcementService.deleteAnnouncement(1);

    assert.equal(del.mock.calls.length, 1);
    assert.equal(result.message, 'Announcement deleted successfully');
  });

  it('throws when the announcement does not exist', async (t) => {
    t.mock.method(announcementRepository, 'findById', async () => null);
    await assert.rejects(
      announcementService.deleteAnnouncement(99),
      /Announcement not found/,
    );
  });
});

describe('AnnouncementService.getAnnouncements', () => {
  it('returns the company announcements', async (t) => {
    const findAll = t.mock.method(announcementRepository, 'findAll', async () => [
      makeAnnouncement({ id: 1, title: 'A' }),
      makeAnnouncement({ id: 2, title: 'B' }),
    ]);

    const announcements = await announcementService.getAnnouncements(1);

    assert.equal(findAll.mock.calls.length, 1);
    assert.deepEqual(findAll.mock.calls[0].arguments, [1]);
    assert.equal(announcements.length, 2);
  });
});
