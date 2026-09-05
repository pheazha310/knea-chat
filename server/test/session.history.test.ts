'use strict';

/**
 * Session management + login history (Security checklist item 11):
 *   - sessions are recorded at login (device/IP) and never deleted on logout
 *     (soft sign-out keeps the login history)
 *   - login history maps to an active / expired / logged_out status
 *   - "sign out all other devices" excludes the caller's current session
 *   - admin history lookup is scoped to the caller's own company
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';

import { AuthService } from '../src/services/Auth.service';
import type { SessionRepository } from '../src/repositories/sessionRepository';
import type { UserRepository } from '../src/repositories/userRepository';
import type { NotificationRepository } from '../src/repositories/notificationRepository';
import type { CompanyRepository } from '../src/repositories/companyRepository';
import type { CreateSessionData, SessionRow } from '../src/types';

const passwordHash = bcrypt.hashSync('password123', 4);

const userRow = {
  id: 7,
  company_id: 1,
  department_id: null,
  first_name: 'Dara',
  last_name: 'Chea',
  email: 'dara@kneachat.com',
  password: passwordHash,
  role: 'admin',
  job_title: 'Manager',
  profile_picture: null,
  status: 'offline',
  is_active: 1,
  last_seen_at: null,
  created_at: new Date('2026-08-01T08:00:00Z'),
  updated_at: new Date('2026-08-01T08:00:00Z'),
};

const userRepository = {
  findByEmail: async (_email: string) => userRow,
  findById: async (_id: number) => userRow,
  create: async (_data: Record<string, unknown>) => 7,
  updateStatus: async (_id: number, _status: string) => {},
  countByCompany: async (_companyId: number) => 1,
  updatePassword: async (_id: number, _hash: string) => {},
};

const sessionRepository = {
  createSession: async (_data: CreateSessionData) => 1,
  logoutSessionsByUser: async (_userId: number) => true,
  deleteSessionsByUser: async (_userId: number) => true,
  listSessionsByUser: async (_userId: number, _limit?: number) => [] as SessionRow[],
  findSessionIdByTokenHash: async (_tokenHash: string) => null,
  logoutOtherSessions: async (_userId: number, _excludeSessionId: number) => 0,
};

const notificationRepository = { create: async (_data: Record<string, unknown>) => 1 };

const companyRepository = {
  findByDomain: async (_domain: string) => ({ id: 1, name: 'KneaChat', domain: 'kneachat.com' }),
  create: async (_data: Record<string, unknown>) => 1,
};

const makeService = () =>
  new AuthService(
    userRepository as unknown as UserRepository,
    notificationRepository as unknown as NotificationRepository,
    companyRepository as unknown as CompanyRepository,
    sessionRepository as unknown as SessionRepository,
    null,
    null,
  );

describe('AuthService.login', () => {
  it('records a session with device + IP and never exposes the password hash', async (t) => {
    const createSession = t.mock.method(
      sessionRepository,
      'createSession',
      async (_data: CreateSessionData) => 42,
    );
    const service = makeService();

    const result = await service.login(
      'dara@kneachat.com',
      'password123',
      '203.0.113.9',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0',
    );

    assert.equal(createSession.mock.calls.length, 1);
    const arg = createSession.mock.calls[0].arguments[0] as CreateSessionData;
    assert.equal(arg.user_id, 7);
    assert.equal(arg.ip_address, '203.0.113.9');
    assert.match(arg.device_info || '', /Chrome/);
    assert.equal((result.user as Record<string, unknown>).password, undefined);
  });

  it('issues a distinct token per concurrent sign-in (unique jti)', async (t) => {
    const hashes: string[] = [];
    t.mock.method(sessionRepository, 'createSession', async (data: CreateSessionData) => {
      hashes.push(data.token_hash);
      return hashes.length;
    });
    const service = makeService();

    await service.login('dara@kneachat.com', 'password123', '10.0.0.1', 'Chrome');
    await service.login('dara@kneachat.com', 'password123', '10.0.0.2', 'Firefox');

    assert.equal(hashes.length, 2);
    assert.notEqual(hashes[0], hashes[1], 'same user + same password must not share a token hash');
  });

  it('rejects sign-in for a deactivated account', async (t) => {
    t.mock.method(userRepository, 'findByEmail', async (_email: string) => ({ ...userRow, is_active: 0 }));
    const service = makeService();
    await assert.rejects(
      service.login('dara@kneachat.com', 'password123'),
      /disabled/,
    );
  });
});

describe('AuthService.logout', () => {
  it('soft-marks sessions logged out instead of deleting the login history', async (t) => {
    const logoutSessions = t.mock.method(sessionRepository, 'logoutSessionsByUser', async (_id: number) => true);
    const deleteSessions = t.mock.method(sessionRepository, 'deleteSessionsByUser', async (_id: number) => true);
    const service = makeService();

    await service.logout(7);

    assert.equal(logoutSessions.mock.calls.length, 1);
    assert.deepEqual(logoutSessions.mock.calls[0].arguments, [7]);
    assert.equal(deleteSessions.mock.calls.length, 0);
  });
});

describe('AuthService.getLoginHistory', () => {
  it('maps each session to active / expired / logged_out without token hashes', async (t) => {
    const future = new Date(Date.now() + 3600_000);
    const past = new Date(Date.now() - 3600_000);
    t.mock.method(sessionRepository, 'listSessionsByUser', async (_userId: number, _limit?: number) => [
      { id: 1, user_id: 7, token_hash: 'abc', device_info: 'Chrome', ip_address: '10.0.0.1', created_at: new Date(), expires_at: future, logged_out_at: null },
      { id: 2, user_id: 7, token_hash: 'def', device_info: 'Firefox', ip_address: '10.0.0.2', created_at: new Date(), expires_at: past, logged_out_at: null },
      { id: 3, user_id: 7, token_hash: 'ghi', device_info: 'Safari', ip_address: '10.0.0.3', created_at: new Date(), expires_at: future, logged_out_at: new Date() },
    ] as SessionRow[]);
    const service = makeService();

    const history = await service.getLoginHistory(7);

    assert.equal(history.length, 3);
    assert.deepEqual(history.map((h) => h.status), ['active', 'expired', 'logged_out']);
    assert.equal((history[0] as unknown as Record<string, unknown>).token_hash, undefined);
    assert.equal(history[1].ip_address, '10.0.0.2');
  });
});

describe('AuthService.revokeOtherSessions', () => {
  it('signs out every session except the caller’s current one', async (t) => {
    const findId = t.mock.method(sessionRepository, 'findSessionIdByTokenHash', async (_hash: string) => 42);
    const logoutOthers = t.mock.method(sessionRepository, 'logoutOtherSessions', async (_id: number, _exclude: number) => 2);
    const service = makeService();

    const result = await service.revokeOtherSessions(7, 'jwt-token-abc');

    assert.deepEqual(result, { revoked: 2 });
    assert.deepEqual(logoutOthers.mock.calls[0].arguments, [7, 42]);
    assert.equal(findId.mock.calls.length, 1);
  });

  it('is a no-op when the current session cannot be resolved', async (t) => {
    const logoutOthers = t.mock.method(sessionRepository, 'logoutOtherSessions', async (_id: number, _exclude: number) => 1);
    const service = makeService();

    const result = await service.revokeOtherSessions(7, 'unknown-token');

    assert.deepEqual(result, { revoked: 0 });
    assert.equal(logoutOthers.mock.calls.length, 0);
  });
});

describe('AuthService.getUserLoginHistory', () => {
  it('lets an admin inspect a user inside their own company', async (t) => {
    const list = t.mock.method(sessionRepository, 'listSessionsByUser', async (_userId: number, _limit?: number) => []);
    const service = makeService();

    const history = await service.getUserLoginHistory(
      { id: 1, email: 'a@x.com', role: 'admin', companyId: 1 },
      7,
    );

    assert.deepEqual(list.mock.calls[0].arguments, [7, 20]);
    assert.equal(history.length, 0);
  });

  it('blocks a company admin from inspecting another company’s user', async (t) => {
    const service = makeService();
    await assert.rejects(
      service.getUserLoginHistory({ id: 1, email: 'a@x.com', role: 'admin', companyId: 99 }, 7),
      /Unauthorized/,
    );
  });

  it('lets a super admin inspect any user regardless of company', async (t) => {
    t.mock.method(sessionRepository, 'listSessionsByUser', async (_userId: number, _limit?: number) => []);
    const service = makeService();

    const history = await service.getUserLoginHistory(
      { id: 1, email: 'root@kneachat.com', role: 'super_admin', companyId: 1 },
      7,
    );

    assert.equal(history.length, 0);
  });
});