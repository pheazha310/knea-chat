'use strict';

// MUST be the first import: seeds connection.registry before presence.handler loads.
import { registryStub } from '../test-helpers/seeds/registry.seed';
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import WebSocket from 'ws';

import { PresenceHandler } from '../src/websocket/presence.handler';
import type { UserRepository } from '../src/repositories/userRepository';
import type { AuthedSocket } from '../src/websocket/connection.registry';

const state = { connectedIds: [] as number[] };
registryStub.getConnectedUsers = () => state.connectedIds;

const statusCalls: Array<{ userId: number; status: string }> = [];
const userModelStub = {
  updateStatus: async (userId: number, status: string) => {
    statusCalls.push({ userId, status });
  },
  findByIds: async (ids: number[]) => ids.map((id) => ({ id, email: `u${id}@kneachat.com` })),
};

const presenceHandler = new PresenceHandler(userModelStub as unknown as UserRepository);

type SentEvent = {
  type?: string;
  message?: string;
  data?: Record<string, unknown>;
};
type SentEvents = SentEvent[];

const fakeWs = (overrides: Partial<AuthedSocket> = {}): AuthedSocket =>
  ({
    userId: 5,
    email: 'ann@kneachat.com',
    sent: [] as SentEvents,
    send(msg: string) {
      (this as { sent: SentEvents }).sent.push(JSON.parse(msg));
    },
    ...overrides,
  }) as unknown as AuthedSocket;

const fakeWss = (clients: unknown[]): WebSocket.Server =>
  ({ clients }) as unknown as WebSocket.Server;

const fakeClient = (readyState: number) => ({
  readyState,
  sent: [] as SentEvents,
  send(msg: string) {
    (this as { sent: SentEvents }).sent.push(JSON.parse(msg));
  },
});

const OPEN = WebSocket.OPEN;

before(() => {
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});
});

after(() => {
  mock.restoreAll();
});

beforeEach(() => {
  state.connectedIds = [];
  statusCalls.length = 0;
});

describe('presenceHandler.handleUserStatusChange', () => {
  it('rejects an invalid status without touching the DB', async (t) => {
    const update = t.mock.method(userModelStub, 'updateStatus', async () => true);
    const ws = fakeWs();

    await presenceHandler.handleUserStatusChange(ws, { status: 'sleeping' }, fakeWss([]));

    assert.equal((ws as unknown as { sent: SentEvents }).sent[0].type, 'error');
    assert.match(String((ws as unknown as { sent: SentEvents }).sent[0].message), /Invalid status/);
    assert.equal(update.mock.calls.length, 0);
  });

  it('accepts all four valid statuses', async (t) => {
    const update = t.mock.method(userModelStub, 'updateStatus', async () => true);

    for (const status of ['online', 'offline', 'away', 'dnd']) {
      const client = fakeClient(OPEN);
      const ws = fakeWs();
      await presenceHandler.handleUserStatusChange(ws, { status }, fakeWss([client]));
      assert.equal(client.sent[0].type, 'user_status_changed');
      assert.equal(client.sent[0].data?.status, status);
    }
    assert.equal(update.mock.calls.length, 4);
  });

  it('persists the status and broadcasts to every open client', async () => {
    const openClient = fakeClient(OPEN);
    const closedClient = fakeClient(WebSocket.CLOSED);
    const wss = fakeWss([openClient, closedClient]);

    const ws = fakeWs();
    await presenceHandler.handleUserStatusChange(ws, { status: 'dnd' }, wss);

    assert.deepEqual(statusCalls, [{ userId: 5, status: 'dnd' }]);

    assert.equal(openClient.sent.length, 1);
    assert.equal(openClient.sent[0].type, 'user_status_changed');
    assert.equal(openClient.sent[0].data?.userId, 5);
    assert.equal(openClient.sent[0].data?.status, 'dnd');

    // Non-open clients must not receive anything.
    assert.equal(closedClient.sent.length, 0);
  });
});

describe('presenceHandler.broadcastUserOnline / broadcastUserOffline', () => {
  it('broadcasts user_online to open clients only', () => {
    const openClient = fakeClient(OPEN);
    const closedClient = fakeClient(WebSocket.CLOSED);

    presenceHandler.broadcastUserOnline(5, 'ann@kneachat.com', fakeWss([openClient, closedClient]));

    assert.equal(openClient.sent[0].type, 'user_online');
    assert.equal(openClient.sent[0].data?.userId, 5);
    assert.equal(closedClient.sent.length, 0);
  });

  it('broadcasts user_offline to open clients only', () => {
    const openClient = fakeClient(OPEN);

    presenceHandler.broadcastUserOffline(5, 'ann@kneachat.com', fakeWss([openClient]));

    assert.equal(openClient.sent[0].type, 'user_offline');
    assert.equal(openClient.sent[0].data?.userEmail, 'ann@kneachat.com');
  });
});

describe('presenceHandler.getOnlineUsers', () => {
  it('returns [] when nobody is connected', async () => {
    assert.deepEqual(await presenceHandler.getOnlineUsers(5, fakeWss([])), []);
  });

  it('marks connected users as online', async (t) => {
    state.connectedIds = [2, 3];
    const findByIds = t.mock.method(userModelStub, 'findByIds', async (ids: number[]) =>
      ids.map((id) => ({ id, email: `u${id}@kneachat.com` })),
    );

    const users = await presenceHandler.getOnlineUsers(5, fakeWss([]));

    assert.deepEqual(findByIds.mock.calls[0].arguments[0], [2, 3]);
    assert.equal(users.length, 2);
    for (const user of users) {
      assert.equal(user.isOnline, true);
    }
  });
});
