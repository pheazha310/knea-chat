'use strict';

// MUST be the first import: seeds connection.registry before message.handler loads.
import { registryStub } from '../test-helpers/seeds/registry.seed';
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

import { seed } from '../test-helpers/module-stub';
import { MessageHandler } from '../src/websocket/message.handler';
import { TypingHandler } from '../src/websocket/typing.handler';
import type { MessageService } from '../src/services/Message.service';
import type { ConversationRepository } from '../src/repositories/conversationRepository';
import type { BroadcastToConversation } from '../src/websocket/broadcast.utils';
import type { AuthedSocket } from '../src/websocket/connection.registry';
import type { OutgoingMessage } from '../src/types';

const broadcastCalls: Array<{ conversationId: number; event: unknown; options: unknown }> = [];
const broadcastToConversation: BroadcastToConversation = async (conversationId, event, options = {}) => {
  broadcastCalls.push({ conversationId, event, options });
};

const sendCalls: Array<{ userId: number; event: unknown }> = [];
registryStub.sendToUser = (userId: number, event: unknown) => {
  sendCalls.push({ userId, event: typeof event === 'string' ? JSON.parse(event) : event });
};

const conversationModelStub = {
  findById: async () => ({ id: 7, type: 'channel', name: 'general' }),
  isMember: async () => true,
  canAccessTeamConversation: async () => true,
};

const fullMessage = (overrides: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  id: 42,
  conversation_id: 7,
  sender_id: 1,
  content: 'Hi @Maya Chen',
  type: 'text',
  reply_to: null,
  created_at: '2026-08-12T10:00:00Z',
  updated_at: '2026-08-12T10:00:00Z',
  is_pinned: 0,
  deleted_at: null,
  first_name: 'Ann',
  last_name: 'Admin',
  email: 'ann@kneachat.com',
  profile_picture: null,
  reactions: [],
  attachments: [],
  mentionedUserIds: [],
  notifiedUserIds: [],
  ...overrides,
});

const messageServiceStub = {
  createMessage: async (data: unknown) => fullMessage(),
  updateMessage: async (messageId: number, content: string, userId: number) =>
    fullMessage({ content: 'edited' }),
  deleteMessage: async () => ({ deletedMessage: fullMessage({ id: 9 }) }),
  pinMessage: async (id: number, userId: number) => fullMessage({ id: 9, is_pinned: 1 }),
  unpinMessage: async (id: number, userId: number) => fullMessage({ id: 9, is_pinned: 0 }),
};

seed('../src/services/Message.service', messageServiceStub);
seed('../src/repositories/conversationRepository', conversationModelStub);
// message.utils is deliberately NOT stubbed — the real serializer is exercised.

const messageHandler = new MessageHandler(
  messageServiceStub as unknown as MessageService,
  conversationModelStub as unknown as ConversationRepository,
  broadcastToConversation,
);
const typingHandler = new TypingHandler(broadcastToConversation);

type FakeAuthedSocket = AuthedSocket & {
  sent: Array<Record<string, unknown>>;
  lastEvent(): Record<string, unknown>;
};

const fakeWs = (overrides: Partial<AuthedSocket> = {}): FakeAuthedSocket => {
  const ws = {
    userId: 1,
    email: 'ann@kneachat.com',
    sent: [] as Array<Record<string, unknown>>,
    send(msg: string) {
      ws.sent.push(JSON.parse(msg));
    },
    lastEvent() {
      return ws.sent[ws.sent.length - 1];
    },
    ...overrides,
  } as FakeAuthedSocket;
  return ws;
};

before(() => {
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});
});

after(() => {
  mock.restoreAll();
});

beforeEach(() => {
  broadcastCalls.length = 0;
  sendCalls.length = 0;
  conversationModelStub.findById = async () => ({ id: 7, type: 'channel', name: 'general' });
  conversationModelStub.isMember = async () => true;
  conversationModelStub.canAccessTeamConversation = async () => true;
});

describe('messageHandler.handleSendMessage', () => {
  it('rejects an event missing content', async (t) => {
    const create = t.mock.method(messageServiceStub, 'createMessage', async (data: unknown) => fullMessage());
    const ws = fakeWs();

    await messageHandler.handleSendMessage(ws, { conversationId: 7 });

    assert.equal(create.mock.calls.length, 0);
    assert.equal(ws.lastEvent().type, 'error');
    assert.match(String(ws.lastEvent().message), /Missing required fields/);
  });

  it('persists, broadcasts to other members, and acks the sender', async (t) => {
    const create = t.mock.method(messageServiceStub, 'createMessage', async (data: unknown) =>
      fullMessage({ mentionedUserIds: [2], notifiedUserIds: [3] }),
    );
    const ws = fakeWs();

    await messageHandler.handleSendMessage(ws, { conversationId: 7, content: 'Hi @Maya Chen' });

    // Persisted as a plain text message (event type is NOT reused as message type).
    assert.deepEqual(create.mock.calls[0].arguments[0], {
      conversation_id: 7,
      sender_id: 1,
      content: 'Hi @Maya Chen',
      type: 'text',
      reply_to: undefined,
    });

    // Broadcast to members, excluding the sender.
    assert.equal(broadcastCalls.length, 1);
    assert.equal(broadcastCalls[0].conversationId, 7);
    assert.equal((broadcastCalls[0].event as { type: string }).type, 'receive_message');
    assert.equal((broadcastCalls[0].event as { message: { id: number } }).message.id, 42);
    assert.deepEqual(broadcastCalls[0].options, { excludeUserId: 1 });

    // Live notifications: mention to user 2, new_message to user 3.
    assert.equal(sendCalls.length, 2);
    const mention = sendCalls.find((c) => c.userId === 2);
    const newMessage = sendCalls.find((c) => c.userId === 3);
    assert.equal((mention?.event as { type: string }).type, 'notification');
    assert.equal((mention?.event as { data: { type: string } }).data.type, 'mention');
    assert.equal((mention?.event as { data: { title: string } }).data.title, 'Ann Admin mentioned you');
    assert.equal((mention?.event as { data: { conversationId: number } }).data.conversationId, 7);
    assert.equal((mention?.event as { data: { messageId: number } }).data.messageId, 42);
    assert.equal((newMessage?.event as { data: { type: string } }).data.type, 'new_message');
    assert.equal((newMessage?.event as { data: { title: string } }).data.title, 'Ann Admin');

    // Ack to sender.
    assert.equal(ws.lastEvent().type, 'message_sent_ack');
    assert.equal((ws.lastEvent().data as { id: number }).id, 42);
  });

  it('never notifies the sender about their own message', async (t) => {
    t.mock.method(messageServiceStub, 'createMessage', async (data: unknown) =>
      fullMessage({ mentionedUserIds: [1, 2], notifiedUserIds: [1, 3] }),
    );
    const ws = fakeWs();

    await messageHandler.handleSendMessage(ws, { conversationId: 7, content: 'self' });

    const ids = sendCalls.map((c) => c.userId);
    assert.ok(!ids.includes(1));
    assert.ok(ids.includes(2));
    assert.ok(ids.includes(3));
  });

  it('sends an error event when the service fails', async (t) => {
    t.mock.method(messageServiceStub, 'createMessage', async (data: unknown) => {
      throw new Error('boom');
    });
    const ws = fakeWs();

    await messageHandler.handleSendMessage(ws, { conversationId: 7, content: 'hi' });

    assert.equal(ws.lastEvent().type, 'error');
    assert.match(String(ws.lastEvent().message), /Failed to send message: boom/);
  });
});

describe('messageHandler.handleMessageEdited', () => {
  it('rejects missing fields', async (t) => {
    const update = t.mock.method(
      messageServiceStub,
      'updateMessage',
      async (messageId: number, content: string, userId: number) => fullMessage(),
    );
    const ws = fakeWs();

    await messageHandler.handleMessageEdited(ws, { messageId: 42 });

    assert.equal(update.mock.calls.length, 0);
    assert.equal(ws.lastEvent().type, 'error');
  });

  it('updates, broadcasts message_updated, and acks', async (t) => {
    const update = t.mock.method(
      messageServiceStub,
      'updateMessage',
      async (messageId: number, content: string, userId: number) => fullMessage({ content: 'edited' }),
    );
    const ws = fakeWs();

    await messageHandler.handleMessageEdited(ws, { messageId: 42, content: 'edited' });

    assert.deepEqual(update.mock.calls[0].arguments, [42, 'edited', 1]);
    assert.equal((broadcastCalls[0].event as { type: string }).type, 'message_updated');
    assert.equal((broadcastCalls[0].event as { message: { conversationId: number } }).message.conversationId, 7);
    assert.deepEqual(broadcastCalls[0].options, {});
    assert.equal(ws.lastEvent().type, 'message_edited_ack');
    assert.equal(ws.lastEvent().messageId, 42);
  });
});

describe('messageHandler.handleMessageDeleted', () => {
  it('rejects a missing messageId', async (t) => {
    const ws = fakeWs();
    await messageHandler.handleMessageDeleted(ws, {});
    assert.equal(ws.lastEvent().type, 'error');
    assert.match(String(ws.lastEvent().message), /Missing required field/);
  });

  it('broadcasts message_deleted and acks', async (t) => {
    const ws = fakeWs();

    await messageHandler.handleMessageDeleted(ws, { messageId: 9 });

    assert.equal((broadcastCalls[0].event as { type: string }).type, 'message_deleted');
    assert.equal((broadcastCalls[0].event as { message: { id: number } }).message.id, 9);
    assert.equal((broadcastCalls[0].event as { message: { conversationId: number } }).message.conversationId, 7);
    assert.equal(ws.lastEvent().type, 'message_deleted_ack');
    assert.equal(ws.lastEvent().messageId, 9);
  });
});

describe('messageHandler.handleMessagePinned', () => {
  it('rejects a missing messageId', async (t) => {
    const ws = fakeWs();
    await messageHandler.handleMessagePinned(ws, {}, true);
    assert.equal(ws.lastEvent().type, 'error');
  });

  it('pins: calls pinMessage and broadcasts message_pinned', async (t) => {
    const pin = t.mock.method(
      messageServiceStub,
      'pinMessage',
      async (id: number, userId: number) => fullMessage({ id: 9 }),
    );
    const ws = fakeWs();

    await messageHandler.handleMessagePinned(ws, { messageId: 9 }, true);

    assert.deepEqual(pin.mock.calls[0].arguments, [9, 1]);
    assert.equal((broadcastCalls[0].event as { type: string }).type, 'message_pinned');
    assert.equal((broadcastCalls[0].event as { message: { isPinned: boolean } }).message.isPinned, true);
    assert.equal(ws.lastEvent().type, 'message_pinned_ack');
  });

  it('unpins: calls unpinMessage and broadcasts message_unpinned', async (t) => {
    const unpin = t.mock.method(
      messageServiceStub,
      'unpinMessage',
      async (id: number, userId: number) => fullMessage({ id: 9 }),
    );
    const ws = fakeWs();

    await messageHandler.handleMessagePinned(ws, { messageId: 9 }, false);

    assert.deepEqual(unpin.mock.calls[0].arguments, [9, 1]);
    assert.equal((broadcastCalls[0].event as { type: string }).type, 'message_unpinned');
    assert.equal((broadcastCalls[0].event as { message: { isPinned: boolean } }).message.isPinned, false);
    assert.equal(ws.lastEvent().type, 'message_unpinned_ack');
  });
});

describe('messageHandler.handleJoinChannel', () => {
  it('rejects a missing id', async (t) => {
    const ws = fakeWs();
    await messageHandler.handleJoinChannel(ws, {});
    assert.equal(ws.lastEvent().type, 'error');
    assert.match(String(ws.lastEvent().message), /Missing required field/);
  });

  it('rejects non-members', async (t) => {
    conversationModelStub.isMember = async () => false;
    const ws = fakeWs();

    await messageHandler.handleJoinChannel(ws, { channelId: 7 });

    assert.equal(ws.lastEvent().type, 'error');
    assert.match(String(ws.lastEvent().message), /not a member/);
  });

  it('confirms membership with joined_channel', async (t) => {
    const ws = fakeWs();
    await messageHandler.handleJoinChannel(ws, { channelId: 7 });
    assert.equal(ws.lastEvent().type, 'joined_channel');
    assert.equal(ws.lastEvent().channelId, 7);
  });

  it('rejects joining a team conversation without team access', async (t) => {
    conversationModelStub.findById = async () => ({ id: 7, type: 'team', name: 'Engineering' });
    conversationModelStub.canAccessTeamConversation = async () => false;
    const ws = fakeWs();

    await messageHandler.handleJoinChannel(ws, { conversationId: 7 });

    assert.equal(ws.lastEvent().type, 'error');
    assert.match(String(ws.lastEvent().message), /must be a member of this team/);
  });
});

describe('messageHandler.handleLeaveChannel', () => {
  it('rejects a missing id', async (t) => {
    const ws = fakeWs();
    await messageHandler.handleLeaveChannel(ws, {});
    assert.equal(ws.lastEvent().type, 'error');
  });

  it('confirms with left_channel', async (t) => {
    const ws = fakeWs();
    await messageHandler.handleLeaveChannel(ws, { conversationId: 7 });
    assert.equal(ws.lastEvent().type, 'left_channel');
    assert.equal(ws.lastEvent().channelId, 7);
  });
});

describe('typingHandler', () => {
  it('rejects a missing conversation id', async (t) => {
    const ws = fakeWs();
    await typingHandler.handleTypingStart(ws, {});
    assert.equal(ws.lastEvent().type, 'error');
    assert.match(String(ws.lastEvent().message), /Missing conversationId or channelId/);
  });

  it('broadcasts typing_start to other members', async () => {
    const ws = fakeWs();
    await typingHandler.handleTypingStart(ws, { conversationId: 7 });

    assert.equal((broadcastCalls[0].event as { type: string }).type, 'typing_start');
    assert.equal((broadcastCalls[0].event as { data: { conversationId: number } }).data.conversationId, 7);
    assert.equal((broadcastCalls[0].event as { data: { userId: number } }).data.userId, 1);
    assert.deepEqual(broadcastCalls[0].options, { excludeUserId: 1 });
  });

  it('broadcasts typing_stop to other members', async () => {
    const ws = fakeWs();
    await typingHandler.handleTypingStop(ws, { channelId: 7 });

    assert.equal((broadcastCalls[0].event as { type: string }).type, 'typing_stop');
    assert.equal((broadcastCalls[0].event as { data: { conversationId: number } }).data.conversationId, 7);
  });
});
