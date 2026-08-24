'use strict';

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

import { userConnections, sendToUser, getConnectedUsers, isUserConnected } from '../src/websocket/connection.registry';
import type { AuthedSocket } from '../src/websocket/connection.registry';

const fakeSocket = (readyState: number, sent: string[] = []): AuthedSocket =>
  ({
    readyState,
    sent,
    send(msg: string) {
      sent.push(msg);
    },
  }) as unknown as AuthedSocket;

beforeEach(() => {
  userConnections.clear();
});

after(() => {
  userConnections.clear();
});

describe('connection.registry', () => {
  it('starts empty', () => {
    assert.deepEqual(getConnectedUsers(), []);
    assert.equal(isUserConnected(1), false);
  });

  it('tracks a user with multiple sockets (multi-tab)', () => {
    userConnections.set(1, [fakeSocket(WebSocket.OPEN), fakeSocket(WebSocket.OPEN)]);
    userConnections.set(2, [fakeSocket(WebSocket.OPEN)]);

    assert.deepEqual(getConnectedUsers(), [1, 2]);
    assert.equal(isUserConnected(1), true);
    assert.equal(isUserConnected(3), false);
  });

  it('sendToUser is a no-op when the user has no connections', () => {
    assert.doesNotThrow(() => sendToUser(99, { type: 'ping' }));
  });

  it('serializes object payloads and delivers to every open socket', () => {
    const sent: string[] = [];
    userConnections.set(1, [fakeSocket(WebSocket.OPEN, sent), fakeSocket(WebSocket.CLOSED, sent)]);

    sendToUser(1, { type: 'ping', n: 1 });

    assert.equal(sent.length, 1);
    assert.equal(JSON.parse(sent[0]).type, 'ping');
  });

  it('passes already-serialized string payloads through untouched', () => {
    const sent: string[] = [];
    userConnections.set(1, [fakeSocket(WebSocket.OPEN, sent)]);

    const raw = '{"type":"pong"}';
    sendToUser(1, raw);

    assert.equal(sent[0], raw);
  });

  it('does not double-stringify string payloads', () => {
    const sent: string[] = [];
    userConnections.set(1, [fakeSocket(WebSocket.OPEN, sent)]);

    sendToUser(1, JSON.stringify({ type: 'notification' }));

    assert.equal(sent[0].startsWith('"'), false);
    assert.equal(JSON.parse(sent[0]).type, 'notification');
  });

  it('reports isUserConnected only while sockets remain', () => {
    userConnections.set(1, [fakeSocket(WebSocket.OPEN)]);
    assert.equal(isUserConnected(1), true);

    // Simulate a disconnect: registry entry removed when the last socket goes.
    userConnections.delete(1);
    assert.equal(isUserConnected(1), false);
  });
});
