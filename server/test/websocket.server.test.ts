'use strict';

// MUST be the first import: seeds connection.registry before websocket.server loads.
import { registryStub } from '../test-helpers/seeds/registry.seed';
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import type http from 'http';

import { ChatWebSocketServer } from '../src/websocket/websocket.server';
import type { MessageHandler } from '../src/websocket/message.handler';
import type { TypingHandler } from '../src/websocket/typing.handler';
import type { PresenceHandler } from '../src/websocket/presence.handler';
import type { CallHandler } from '../src/websocket/call.handler';
import type { AuthedSocket } from '../src/websocket/connection.registry';

const handlerCalls: Array<{ name: string; ws: unknown; event: unknown; extra?: unknown }> = [];
const messageHandlerStub: Record<string, (ws: unknown, event: unknown, extra?: unknown) => Promise<void>> = {};
[
  'handleSendMessage',
  'handleForwardMessage',
  'handleMessageEdited',
  'handleMessageDeleted',
  'handleMessagePinned',
  'handleJoinChannel',
  'handleLeaveChannel',
].forEach((name) => {
  messageHandlerStub[name] = async (ws, event, extra) => {
    handlerCalls.push({ name, ws, event, extra });
  };
});

const typingHandlerStub = {
  handleTypingStart: async (ws: unknown, event: unknown) => handlerCalls.push({ name: 'handleTypingStart', ws, event }),
  handleTypingStop: async (ws: unknown, event: unknown) => handlerCalls.push({ name: 'handleTypingStop', ws, event }),
};

const callCalls: Array<{ name: string; [key: string]: unknown }> = [];
const callHandlerStub: Record<string, (ws: unknown, event: unknown) => Promise<void>> = {};
[
  'handleCallStart',
  'handleCallAccept',
  'handleCallDecline',
  'handleCallEnd',
  'handleRtcOffer',
  'handleRtcAnswer',
  'handleRtcIce',
].forEach((name) => {
  callHandlerStub[name] = async (ws, event) => {
    callCalls.push({ name, ws, event });
  };
});

const presenceCalls: Array<{ name: string; [key: string]: unknown }> = [];
const presenceHandlerStub = {
  handleUserStatusChange: async (ws: unknown, event: unknown, wss: unknown) =>
    presenceCalls.push({ name: 'handleUserStatusChange', ws, event, wss }),
  broadcastUserOnline: (userId: number, userEmail: string, wss: unknown) =>
    presenceCalls.push({ name: 'broadcastUserOnline', userId, userEmail, wss }),
  broadcastUserOffline: (userId: number, userEmail: string, wss: unknown) =>
    presenceCalls.push({ name: 'broadcastUserOffline', userId, userEmail, wss }),
  sendPresenceSnapshot: (ws: unknown) => {
    presenceCalls.push({ name: 'sendPresenceSnapshot', ws });
    (ws as FakeWs).send(
      JSON.stringify({ type: 'presence_snapshot', data: { userIds: [] } }),
    );
  },
  getOnlineUsers: async () => [],
};

const wsServer = new ChatWebSocketServer({
  messageHandler: messageHandlerStub as unknown as MessageHandler,
  typingHandler: typingHandlerStub as unknown as TypingHandler,
  presenceHandler: presenceHandlerStub as unknown as PresenceHandler,
  callHandler: callHandlerStub as unknown as CallHandler,
});

class FakeWs extends EventEmitter {
  sent: Array<Record<string, unknown>> = [];
  isAlive = true;
  closeCode: number | null = null;
  closeReason: string | null = null;
  userId?: number;
  email?: string;

  send(msg: string) {
    this.sent.push(JSON.parse(msg));
  }
  close(code?: number, reason?: string) {
    this.closeCode = code ?? null;
    this.closeReason = reason ?? null;
    this.emit('close');
  }
  ping() {}
  terminate() {}
  lastEvent() {
    return this.sent[this.sent.length - 1];
  }
}

class FakeWss extends EventEmitter {
  clients: FakeWs[] = [];
}

const makeReq = (url = '/') => ({ url, headers: { host: 'localhost:8080' } });

// handleMessage accepts WebSocket.RawData (Buffer | ArrayBuffer | Buffer[]);
// tests pass strings, so wrap them in a Buffer.
const toRaw = (payload: string): WebSocket.RawData => Buffer.from(payload);

const signToken = (payload: Record<string, unknown>) => jwt.sign(payload, process.env.JWT_SECRET || 'your-secret-key');

before(() => {
  mock.method(console, 'log', () => {});
  mock.method(console, 'warn', () => {});
  mock.method(console, 'error', () => {});
});

// attach starts a 30s heartbeat interval; emit 'close' on every wss we created
// so the interval is cleared and the test process can exit.
const createdWss: FakeWss[] = [];

after(() => {
  for (const wss of createdWss) wss.emit('close');
  mock.restoreAll();
});

beforeEach(() => {
  handlerCalls.length = 0;
  presenceCalls.length = 0;
  callCalls.length = 0;
  registryStub.userConnections.clear();
});

describe('handleMessage routing', () => {
  const cases: Array<[string, string, unknown]> = [
    ['send_message', 'handleSendMessage', null],
    ['forward_message', 'handleForwardMessage', null],
    ['message_edited', 'handleMessageEdited', null],
    ['message_deleted', 'handleMessageDeleted', null],
    ['message_pinned', 'handleMessagePinned', true],
    ['message_unpinned', 'handleMessagePinned', false],
    ['typing_start', 'handleTypingStart', null],
    ['typing_stop', 'handleTypingStop', null],
    ['join_channel', 'handleJoinChannel', null],
    ['leave_channel', 'handleLeaveChannel', null],
    ['call_start', 'handleCallStart', null],
    ['call_accept', 'handleCallAccept', null],
    ['call_decline', 'handleCallDecline', null],
    ['call_end', 'handleCallEnd', null],
    ['webrtc_offer', 'handleRtcOffer', null],
    ['webrtc_answer', 'handleRtcAnswer', null],
    ['webrtc_ice', 'handleRtcIce', null],
  ];

  for (const [eventType, handlerName, extra] of cases) {
    it(`routes '${eventType}' to ${handlerName}`, () => {
      const ws = new FakeWs() as unknown as AuthedSocket;
      const event = { type: eventType, conversationId: 7 };

      wsServer.handleMessage(ws, toRaw(JSON.stringify(event)), new FakeWss() as unknown as WebSocket.Server);

      const call =
        handlerCalls.find((c) => c.name === handlerName) ||
        callCalls.find((c) => c.name === handlerName);
      assert.ok(call, `expected a call to ${handlerName}`);
      assert.deepEqual(call.event, event);
      assert.equal(call.extra, extra ?? undefined);
    });
  }

  it("routes 'user_status' to the presence handler with the wss instance", () => {
    const ws = new FakeWs() as unknown as AuthedSocket;
    const wss = new FakeWss();
    const event = { type: 'user_status', status: 'dnd' };

    wsServer.handleMessage(ws, toRaw(JSON.stringify(event)), wss as unknown as WebSocket.Server);

    assert.equal(presenceCalls.length, 1);
    assert.equal(presenceCalls[0].name, 'handleUserStatusChange');
    assert.deepEqual(presenceCalls[0].event, event);
    assert.equal(presenceCalls[0].wss, wss);
  });

  it("answers 'ping' with a pong event", () => {
    const ws = new FakeWs() as unknown as AuthedSocket;
    wsServer.handleMessage(ws, toRaw(JSON.stringify({ type: 'ping' })), new FakeWss() as unknown as WebSocket.Server);
    assert.equal((ws as unknown as FakeWs).lastEvent().type, 'pong');
  });

  it('rejects unknown event types with an error event', () => {
    const ws = new FakeWs() as unknown as AuthedSocket;
    wsServer.handleMessage(ws, toRaw(JSON.stringify({ type: 'teleport' })), new FakeWss() as unknown as WebSocket.Server);
    assert.equal((ws as unknown as FakeWs).lastEvent().type, 'error');
    assert.match(String((ws as unknown as FakeWs).lastEvent().message), /Unknown event type: teleport/);
  });

  it('rejects malformed JSON with an error event', () => {
    const ws = new FakeWs() as unknown as AuthedSocket;
    wsServer.handleMessage(ws, toRaw('{not json'), new FakeWss() as unknown as WebSocket.Server);
    assert.equal((ws as unknown as FakeWs).lastEvent().type, 'error');
    assert.match(String((ws as unknown as FakeWs).lastEvent().message), /Failed to process message/);
  });
});

describe('setupWebSocket connection lifecycle', () => {
  const makeWss = (): FakeWss => {
    const wss = new FakeWss();
    createdWss.push(wss);
    return wss;
  };

  it('rejects connections without a token', () => {
    const wss = makeWss();
    wsServer.attach(wss as unknown as WebSocket.Server, null as unknown as http.Server);

    const ws = new FakeWs();
    wss.emit('connection', ws, makeReq('/'));

    assert.equal(ws.closeCode, 4001);
    assert.match(String(ws.closeReason), /Token required/);
    assert.equal(registryStub.userConnections.size, 0);
  });

  it('rejects connections with an invalid token', () => {
    const wss = makeWss();
    wsServer.attach(wss as unknown as WebSocket.Server, null as unknown as http.Server);

    const ws = new FakeWs();
    wss.emit('connection', ws, makeReq('/?token=garbage'));

    assert.equal(ws.closeCode, 4001);
    assert.match(String(ws.closeReason), /Invalid token/);
  });

  it('accepts a valid token, registers the user, and acks', () => {
    const wss = makeWss();
    wsServer.attach(wss as unknown as WebSocket.Server, null as unknown as http.Server);

    const token = signToken({ id: 5, email: 'alice@kneachat.com', role: 'employee', companyId: 1 });
    const ws = new FakeWs();
    wss.emit('connection', ws, makeReq(`/?token=${token}`));

    assert.equal(ws.closeCode, null);
    assert.equal(ws.userId, 5);
    assert.equal(ws.email, 'alice@kneachat.com');

    // Registered in the registry and presence broadcast.
    assert.equal(registryStub.userConnections.get(5)!.length, 1);
    assert.equal(presenceCalls[0].name, 'broadcastUserOnline');
    assert.equal(presenceCalls[0].userId, 5);

    // connection_ack sent.
    const ack = ws.sent.find((e) => e.type === 'connection_ack');
    assert.ok(ack);
    assert.equal((ack as { userId: number }).userId, 5);

    // Presence snapshot sent so the new client knows who is already online.
    assert.equal(presenceCalls.some((c) => c.name === 'sendPresenceSnapshot'), true);
    const snapshot = ws.sent.find((e) => e.type === 'presence_snapshot');
    assert.ok(snapshot);
    assert.deepEqual((snapshot as { data: { userIds: number[] } }).data.userIds, []);
  });

  it('processes inbound messages through the router', () => {
    const wss = makeWss();
    wsServer.attach(wss as unknown as WebSocket.Server, null as unknown as http.Server);

    const token = signToken({ id: 5, email: 'alice@kneachat.com', role: 'employee', companyId: 1 });
    const ws = new FakeWs();
    wss.emit('connection', ws, makeReq(`/?token=${token}`));

    ws.emit('message', JSON.stringify({ type: 'ping' }));

    assert.equal(ws.lastEvent().type, 'pong');
  });

  it('cleans up the connection registry and broadcasts offline on close', () => {
    const wss = makeWss();
    wsServer.attach(wss as unknown as WebSocket.Server, null as unknown as http.Server);

    const token = signToken({ id: 5, email: 'alice@kneachat.com', role: 'employee', companyId: 1 });
    const ws = new FakeWs();
    wss.emit('connection', ws, makeReq(`/?token=${token}`));

    assert.equal(registryStub.userConnections.get(5)!.length, 1);

    ws.emit('close');

    assert.equal(registryStub.userConnections.has(5), false);
    assert.equal(presenceCalls.at(-1)?.name, 'broadcastUserOffline');
    assert.equal(presenceCalls.at(-1)?.userId, 5);
  });
});
