'use strict';

/**
 * SearchService — quick message/user search plus the global Search view
 * (SRS US-17 / FR-16).
 *   - searchMessages / searchUsers delegate to the message/user repositories
 *   - globalOverview runs all seven scopes (messages, people, teams,
 *     channels, files, meetings, tasks) with the viewer context and a 5-hit
 *     preview limit, and groups their results
 *   - searchScope routes a scope to the matching GlobalSearchRepository query
 *     with the requested pagination
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SearchService } from '../src/services/Search.service';
import type { MessageRepository } from '../src/repositories/messageRepository';
import type { UserRepository } from '../src/repositories/userRepository';
import type { GlobalSearchRepository } from '../src/repositories/globalSearchRepository';
import type { AuthUser } from '../src/types';

const emptyPage = (limit = 5) => ({ items: [], total: 0, page: 1, limit });

const globalSearchRepository = {
  searchMessages: async () => emptyPage(),
  searchPeople: async () => emptyPage(),
  searchTeams: async () => emptyPage(),
  searchChannels: async () => emptyPage(),
  searchFiles: async () => emptyPage(),
  searchMeetings: async () => emptyPage(),
  searchTasks: async () => emptyPage(),
};

const messageRepository = {
  search: async () => [],
};

const userRepository = {
  search: async () => [],
};

const searchService = new SearchService(
  messageRepository as unknown as MessageRepository,
  userRepository as unknown as UserRepository,
  globalSearchRepository as unknown as GlobalSearchRepository,
);

const makeUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: 5,
  email: 'dara@kneachat.com',
  role: 'manager',
  companyId: 1,
  ...overrides,
});

describe('SearchService quick search', () => {
  it('delegates message search with normalized pagination', async (t) => {
    const search = t.mock.method(messageRepository, 'search', async () => []);
    await searchService.searchMessages(5, 'roadmap', { conversation_id: '7', page: 2, limit: 5 });
    assert.deepEqual(search.mock.calls[0]?.arguments, [5, 'roadmap', { conversation_id: '7', page: 2, limit: 5 }]);
  });

  it('defaults message search pagination when omitted', async (t) => {
    const search = t.mock.method(messageRepository, 'search', async () => []);
    await searchService.searchMessages(5, 'hello');
    assert.deepEqual(search.mock.calls[0]?.arguments, [5, 'hello', { conversation_id: undefined, page: 1, limit: 20 }]);
  });

  it('delegates user search to the user repository', async (t) => {
    const search = t.mock.method(userRepository, 'search', async () => []);
    await searchService.searchUsers(1, 'maya', 10);
    assert.deepEqual(search.mock.calls[0]?.arguments, [1, 'maya', 10]);
  });
});

describe('SearchService.globalOverview', () => {
  const SEVEN = [
    'searchMessages',
    'searchPeople',
    'searchTeams',
    'searchChannels',
    'searchFiles',
    'searchMeetings',
    'searchTasks',
  ] as const;

  it('queries every scope with the viewer context and a preview limit of 5', async (t) => {
    const mocks = SEVEN.map((name) =>
      t.mock.method(globalSearchRepository, name, async () => ({ items: [{ id: 1 }], total: 3, page: 1, limit: 5 })),
    );

    const filters = { q: 'quarterly', team_id: 2, date_from: '2026-08-01', date_to: '2026-08-31' };
    const groups = await searchService.globalOverview(makeUser(), filters);

    const ctx = { userId: 5, companyId: 1, role: 'manager' };
    for (const mock of mocks) {
      assert.equal(mock.mock.calls.length, 1, 'scope queried once');
      assert.deepEqual(mock.mock.calls[0]?.arguments, [ctx, filters, 1, 5]);
    }

    assert.equal(groups.messages.total, 3);
    assert.equal(groups.people.items.length, 1);
    assert.equal(groups.teams.total, 3);
    assert.equal(groups.channels.total, 3);
    assert.equal(groups.files.total, 3);
    assert.equal(groups.meetings.total, 3);
    assert.equal(groups.tasks.total, 3);
  });

  it('runs every scope even when one has no hits', async (t) => {
    const mocks = SEVEN.map((name, i) =>
      t.mock.method(globalSearchRepository, name, async () =>
        i === 3 ? { items: [], total: 0, page: 1, limit: 5 } : { items: [{ id: 1 }], total: 1, page: 1, limit: 5 }),
    );

    const groups = await searchService.globalOverview(makeUser(), { q: 'x' });

    assert.equal(groups.channels.total, 0);
    assert.equal(groups.messages.total, 1);
    assert.ok(mocks.every((m) => m.mock.calls.length === 1));
  });
});

describe('SearchService.searchScope', () => {
  it('routes each scope to its own repository query with pagination', async (t) => {
    const cases: Array<[string, string]> = [
      ['messages', 'searchMessages'],
      ['people', 'searchPeople'],
      ['teams', 'searchTeams'],
      ['channels', 'searchChannels'],
      ['files', 'searchFiles'],
      ['meetings', 'searchMeetings'],
      ['tasks', 'searchTasks'],
    ];
    for (const [scope, method] of cases) {
      const mock = t.mock.method(
        globalSearchRepository as unknown as Record<string, () => Promise<unknown>>,
        method,
        async () => ({ items: [{ id: 9 }], total: 21, page: 2, limit: 10 }),
      );
      const result = await searchService.searchScope(
        makeUser(),
        scope as 'messages',
        { q: 'plan' },
        2,
        10,
      );
      assert.equal(mock.mock.calls.length, 1, `${method} called`);
      assert.deepEqual(mock.mock.calls[0]?.arguments, [
        { userId: 5, companyId: 1, role: 'manager' },
        { q: 'plan' },
        2,
        10,
      ]);
      assert.equal((result as { total: number }).total, 21);
    }
  });

  it('rejects an unknown scope', async () => {
    await assert.rejects(
      searchService.searchScope(makeUser(), 'widgets' as 'messages', { q: 'x' }),
      /Unknown search scope: widgets/,
    );
  });
});
