'use strict';

// MUST be the first import: seeds connection.registry before workspace.events loads.
import { registryStub } from '../test-helpers/seeds/registry.seed';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { emitWorkspaceChanged } from '../src/websocket/workspace.events';
import type { AuthedSocket } from '../src/websocket/connection.registry';

// WebSocket.OPEN === 1, WebSocket.CLOSED === 3 (ws spec constants).
class FakeSocket {
  sent: Array<Record<string, unknown>> = [];
  constructor(
    public companyId: number,
    public readyState: number,
  ) {}
  send(payload: string) {
    this.sent.push(JSON.parse(payload));
  }
}

const reg = (userId: number, sockets: FakeSocket[]) =>
  registryStub.userConnections.set(userId, sockets as unknown as AuthedSocket[]);

beforeEach(() => {
  registryStub.userConnections.clear();
});

describe('emitWorkspaceChanged', () => {
  it('delivers workspace_changed only to open sockets of the target company', () => {
    const inCompany = new FakeSocket(1, 1); // open, company 1
    const inCompany2 = new FakeSocket(1, 1); // open, company 1
    const otherCompany = new FakeSocket(2, 1); // open, company 2
    const closed = new FakeSocket(1, 3); // closed, company 1

    reg(10, [inCompany]);
    reg(11, [inCompany2]);
    reg(20, [otherCompany]);
    reg(12, [closed]);

    emitWorkspaceChanged(1, 'teams');

    assert.equal(inCompany.sent.length, 1);
    assert.equal(inCompany.sent[0].type, 'workspace_changed');
    assert.deepEqual(inCompany.sent[0].data, { kind: 'teams' });
    assert.ok(inCompany.sent[0].timestamp, 'event carries a timestamp');

    assert.equal(inCompany2.sent.length, 1);
    assert.equal(otherCompany.sent.length, 0, 'other companies are not notified');
    assert.equal(closed.sent.length, 0, 'closed sockets are not notified');
  });

  it('emits the channels kind', () => {
    const s = new FakeSocket(1, 1);
    reg(10, [s]);

    emitWorkspaceChanged(1, 'channels');

    assert.deepEqual(s.sent[0].data, { kind: 'channels' });
  });

  it('is a no-op when nobody from the company is connected', () => {
    const s = new FakeSocket(2, 1);
    reg(10, [s]);

    emitWorkspaceChanged(1, 'teams');

    assert.equal(s.sent.length, 0);
  });
});
