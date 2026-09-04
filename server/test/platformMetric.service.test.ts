'use strict';

/**
 * PlatformMetricService — live Super Admin monitoring statistics.
 *   - aggregates DB counts, presence, today's activity and storage
 *   - always returns a full 7-day message chart (empty days filled in)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PlatformMetricService } from '../src/services/PlatformMetric.service';
import type { PlatformMetricRepository } from '../src/repositories/platformMetricRepository';

const platformMetricRepository = {
  getCounts: async () => ({
    companies: 1, users: 7, active_users: 6, teams: 2, channels: 4, departments: 3,
    messages: 120, conversations: 6, shared_files: 9, tasks: 5, meetings: 2, announcements: 1,
    active_sessions: 3,
  }),
  countOnlineUsers: async () => 4,
  getToday: async () => ({ messages: 12, users_joined: 1, companies_created: 0 }),
  getStorage: async () => ({ attachment_files: 8, attachment_bytes: 2048 }),
  getWeeklyMessages: async () => [],
};

const service = new PlatformMetricService(
  platformMetricRepository as unknown as PlatformMetricRepository,
);

describe('PlatformMetricService.getMetrics', () => {
  it('assembles totals, presence, today activity and storage', async (t) => {
    const counts = t.mock.method(platformMetricRepository, 'getCounts', async () => ({
      companies: 3, users: 100, active_users: 80, teams: 9, channels: 12, departments: 5,
      messages: 5000, conversations: 40, shared_files: 20, tasks: 30, meetings: 6, announcements: 4,
      active_sessions: 21,
    }));
    const online = t.mock.method(platformMetricRepository, 'countOnlineUsers', async () => 12);
    const today = t.mock.method(platformMetricRepository, 'getToday', async () => ({ messages: 60, users_joined: 2, companies_created: 1 }));
    const storage = t.mock.method(platformMetricRepository, 'getStorage', async () => ({ attachment_files: 4, attachment_bytes: 1000 }));
    t.mock.method(platformMetricRepository, 'getWeeklyMessages', async () => []);

    const metrics = await service.getMetrics();

    assert.equal(counts.mock.calls.length, 1);
    assert.equal(online.mock.calls.length, 1);
    assert.equal(today.mock.calls.length, 1);
    assert.equal(storage.mock.calls.length, 1);
    assert.equal(metrics.totals.users, 100);
    assert.equal(metrics.totals.active_sessions, 21);
    assert.equal(metrics.online_users, 12);
    assert.equal(metrics.today.messages, 60);
    assert.equal(metrics.storage.attachment_bytes, 1000);
  });

  it('always returns seven buckets for the weekly chart, oldest first', async (t) => {
    t.mock.method(platformMetricRepository, 'getWeeklyMessages', async () => []);
    const metrics = await service.getMetrics();
    assert.equal(metrics.weekly_messages.length, 7);
    // Days are ascending ISO dates ending today.
    const days = metrics.weekly_messages.map((row) => row.day);
    assert.ok(days[6] <= new Date().toISOString().slice(0, 10));
    assert.ok(metrics.weekly_messages.every((row) => row.messages === 0));
  });

  it('keeps reported message counts inside the seven-day window', async (t) => {
    const today = new Date();
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(today.getDate() - 2);
    t.mock.method(platformMetricRepository, 'getWeeklyMessages', async () => [
      { day: twoDaysAgo.toISOString().slice(0, 10), messages: 33 },
    ]);
    const metrics = await service.getMetrics();
    const withMessages = metrics.weekly_messages.filter((row) => row.messages > 0);
    assert.equal(withMessages.length, 1);
    assert.equal(withMessages[0].messages, 33);
  });
});
