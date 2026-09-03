'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { NotificationPreferenceService } from '../src/services/NotificationPreference.service';
import type { NotificationPreferenceRepository } from '../src/repositories/notificationPreferenceRepository';

const makePrefRepo = (rows: Array<Record<string, any>> = []) => ({
  rows,
  findByUser: async (userId: number) => rows.filter((r) => r.user_id === userId),
  set: async (data: Record<string, any>) => {
    const existing = rows.find((r) => r.user_id === data.user_id && r.category === data.category);
    if (existing) existing.enabled = data.enabled ? 1 : 0;
    else rows.push({ id: rows.length + 1, user_id: data.user_id, category: data.category, enabled: data.enabled ? 1 : 0 });
  },
  findDisabledUserIds: async (category: string, userIds: number[]) =>
    rows.filter((r) => r.category === category && r.enabled === 0 && userIds.includes(r.user_id)).map((r) => r.user_id),
  isEnabled: async (userId: number, category: string) => {
    const row = rows.find((r) => r.user_id === userId && r.category === category);
    return !row || row.enabled === 1;
  },
});

describe('NotificationPreferenceService', () => {
  it('reports every category as enabled by default (no rows yet)', async () => {
    const repo = makePrefRepo();
    const svc = new NotificationPreferenceService(repo as unknown as NotificationPreferenceRepository);
    const prefs = await svc.getPreferences(1);
    assert.equal(prefs.length, 7);
    assert.ok(prefs.every((p) => p.enabled));
    assert.ok(prefs.some((p) => p.category === 'messages'));
    assert.ok(prefs.some((p) => p.category === 'tasks'));
  });

  it('rejects an unknown category', async () => {
    const repo = makePrefRepo();
    const svc = new NotificationPreferenceService(repo as unknown as NotificationPreferenceRepository);
    await assert.rejects(svc.setPreference(1, 'telepathy', true), /Unknown notification category/);
  });

  it('persists a disabled category and reflects it in getPreferences', async () => {
    const repo = makePrefRepo();
    const svc = new NotificationPreferenceService(repo as unknown as NotificationPreferenceRepository);
    await svc.setPreference(1, 'messages', false);
    const prefs = await svc.getPreferences(1);
    assert.equal(prefs.find((p) => p.category === 'messages')?.enabled, false);
    // Other categories are untouched.
    assert.equal(prefs.find((p) => p.category === 'mentions')?.enabled, true);
  });

  it('filterEnabled drops users who muted the category and keeps the rest', async () => {
    const repo = makePrefRepo([
      { id: 1, user_id: 2, category: 'messages', enabled: 0 },
    ]);
    const svc = new NotificationPreferenceService(repo as unknown as NotificationPreferenceRepository);
    const recipients = await svc.filterEnabled('messages', [1, 2, 3, 2]);
    assert.deepEqual(recipients.sort((a, b) => a - b), [1, 3]);
  });

  it('isEnabled defaults to true and honors the stored row', async () => {
    const repo = makePrefRepo([
      { id: 1, user_id: 7, category: 'announcements', enabled: 0 },
    ]);
    const svc = new NotificationPreferenceService(repo as unknown as NotificationPreferenceRepository);
    assert.equal(await svc.isEnabled(7, 'announcements'), false);
    assert.equal(await svc.isEnabled(7, 'messages'), true);
    assert.equal(await svc.isEnabled(8, 'announcements'), true);
  });
});
