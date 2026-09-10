'use strict';

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { OmniChannelService } from '../src/services/OmniChannel.service';
import { ChannelRegistry } from '../src/integrations/omni/channelRegistry';
import type { ChannelAdapter, OmniInboundMessage } from '../src/integrations/omni/omni.types';

/** A normalized inbound message ready for the generic engine. */
const makeMessage = (overrides: Partial<OmniInboundMessage> = {}): OmniInboundMessage => ({
  externalContactId: '123456789',
  username: 'john123',
  firstName: 'John',
  lastName: 'Smith',
  externalMessageId: '111',
  content: 'Hello, I need help.',
  media: null,
  externalTimestamp: new Date(1700000000 * 1000),
  metadata: null,
  ...overrides,
});

interface Harness {
  service: OmniChannelService;
  contacts: Map<string, unknown>;
  externalConversations: Array<Record<string, unknown>>;
  externalMessages: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  broadcasts: Array<{ conversationId: number; event: unknown; options?: unknown }>;
  sendCalls: Array<Record<string, unknown>>;
  attachmentCreates: Array<Record<string, unknown>>;
  conversationRepo: Record<string, unknown>;
  adapter: ChannelAdapter;
}

/** Build an OmniChannelService with in-memory fakes + a fake channel adapter. */
const makeHarness = (adapterOverrides: Record<string, unknown> = {}): Harness => {
  const contacts = new Map<string, unknown>();
  const externalConversations: Array<Record<string, unknown>> = [];
  const externalMessages: Array<Record<string, unknown>> = [];
  const users: Array<Record<string, unknown>> = [];
  const broadcasts: Array<{ conversationId: number; event: unknown; options?: unknown }> = [];
  const sendCalls: Array<Record<string, unknown>> = [];
  const attachmentCreates: Array<Record<string, unknown>> = [];

  const externalRepo = {
    findByChannelAndExternalId: async (_channel: string, externalId: string) =>
      contacts.get(externalId) || null,
    createContact: async (data: Record<string, unknown>) => {
      contacts.set(String(data.external_contact_id), {
        id: 1,
        user_id: data.user_id,
        channel: data.channel,
        external_contact_id: data.external_contact_id,
        username: data.username || null,
        first_name: data.first_name || null,
        last_name: data.last_name || null,
        metadata: data.metadata || null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      return 1;
    },
    findConversationByContact: async (_channel: string, contactId: number) =>
      externalConversations.find((c) => c.contact_id === contactId) || null,
    findConversationWithContact: async (conversationId: number) => {
      const row = externalConversations.find((c) => c.conversation_id === conversationId);
      if (!row) return null;
      return { ...row, external_contact_id: '123456789', first_name: 'John', last_name: 'Smith' };
    },
    findByConversationId: async (conversationId: number) =>
      externalConversations.find((c) => c.conversation_id === conversationId) || null,
    findByConversationIds: async (ids: number[]) =>
      externalConversations.filter((c) => ids.includes(c.conversation_id as number)),
    createConversation: async (data: Record<string, unknown>) => {
      externalConversations.push({ id: 1, ...data });
      return 1;
    },
    updateConversationStatus: async (conversationId: number, status: string) => {
      const row = externalConversations.find((c) => c.conversation_id === conversationId);
      if (row) row.status = status;
      return true;
    },
    updateAssignedAgent: async (conversationId: number, agentId: number | null) => {
      const row = externalConversations.find((c) => c.conversation_id === conversationId);
      if (row) row.assigned_agent_id = agentId;
      return true;
    },
    findMessageByExternalId: async (_channel: string, externalMessageId: string) =>
      externalMessages.find((m) => m.external_message_id === externalMessageId) || null,
    findByMessageId: async (messageId: number) =>
      externalMessages.find((m) => m.message_id === messageId) || null,
    createMessage: async (data: Record<string, unknown>) => {
      externalMessages.push({ id: externalMessages.length + 1, ...data });
      return externalMessages.length;
    },
  };

  const userRepo = {
    create: async (data: Record<string, unknown>) => {
      users.push(data);
      return 100 + users.length;
    },
    findInternalUserIds: async () => [2, 3, 4],
  };

  const companyRepo = {
    findByDomain: async (domain: string) => ({ id: 999, name: 'Omni-Channel External', domain }),
  };

  const conversationRepo = {
    create: async () => 500,
    addMember: async () => 1,
    isMember: async () => true,
    findById: async (id: number) => ({ id, type: 'direct', name: 'John Smith (Telegram)' }),
    findMemberIds: async () => [2, 3, 4],
  };

  const messageRepo = {
    lastCreated: { type: 'text', content: 'Hello, I need help.' } as Record<string, unknown>,
    create: async (data: Record<string, unknown>) => {
      messageRepo.lastCreated = data;
      return 700;
    },
    createAttachment: async (data: Record<string, unknown>) => {
      attachmentCreates.push(data);
      return 1;
    },
    findAttachments: async () => [],
    findById: async (id: number) => ({
      id,
      conversation_id: 500,
      sender_id: 100,
      content: 'Hello, I need help.',
      type: 'text',
      created_at: new Date(),
      updated_at: new Date(),
    }),
    findByIdWithSender: async (id: number) => ({
      id,
      conversation_id: 500,
      sender_id: 100,
      content: messageRepo.lastCreated.content ?? 'Hello, I need help.',
      type: messageRepo.lastCreated.type ?? 'text',
      reply_to: null,
      forwarded_from: null,
      created_at: new Date(),
      updated_at: new Date(),
      is_pinned: 0,
      deleted_at: null,
      first_name: 'John',
      last_name: 'Smith',
      email: 'telegram.123456789@external.kneachat.local',
      profile_picture: null,
    }),
  };

  const messageService = {
    createMessageNotifications: async () => [3, 4],
  };

  const adapter: ChannelAdapter = {
    channel: 'telegram',
    parseInbound: async (payload: unknown) =>
      ((payload as { messages?: OmniInboundMessage[] })?.messages || []) as OmniInboundMessage[],
    downloadMedia: async () => Buffer.from('fake-image-bytes'),
    sendMessage: async (chatId: number, text: string, options?: unknown) => {
      sendCalls.push({ chatId, text, options });
      return { ok: true, externalMessageId: '2222' };
    },
    getHealth: async () => ({ connected: true }),
    ...adapterOverrides,
  };

  const registry = new ChannelRegistry();
  registry.register(adapter);

  const service = new OmniChannelService(
    registry,
    externalRepo as never,
    userRepo as never,
    companyRepo as never,
    conversationRepo as never,
    messageRepo as never,
    messageService as never,
    broadcast as never,
  );

  async function broadcast(
    conversationId: number,
    event: unknown,
    options?: unknown,
  ): Promise<void> {
    broadcasts.push({ conversationId, event, options });
  }

  return {
    service,
    contacts,
    externalConversations,
    externalMessages,
    users,
    broadcasts,
    sendCalls,
    attachmentCreates,
    conversationRepo,
    adapter,
  };
};

// Media tests download files into the shared uploads directory — redirect it
// to a temp folder for this process and clean it up afterwards.
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knea-omni-test-'));
process.env.UPLOAD_DIR = mediaDir;

after(() => {
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

describe('OmniChannelService — inbound processing', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('ignores an empty batch (unsupported updates) safely', async () => {
    const result = await h.service.processInbound('telegram', { messages: [] });
    assert.deepEqual(result, { processed: 0, ignored: 0 });
    assert.equal(h.externalMessages.length, 0);
  });

  it('creates the contact, conversation and message, then broadcasts', async () => {
    const result = await h.service.processInbound('telegram', { messages: [makeMessage()] });

    assert.deepEqual(result, { processed: 1, ignored: 0 });

    // Contact: one shadow user with role 'external' + one contact row.
    assert.ok(h.contacts.has('123456789'));
    assert.equal(h.users.length, 1);
    assert.equal(h.users[0].role, 'external');
    assert.equal(h.users[0].company_id, 999);
    assert.equal(h.users[0].email, 'telegram.123456789@external.kneachat.local');
    assert.equal(h.users[0].first_name, 'John');

    // Conversation: internal row + external mapping + agents joined.
    assert.equal(h.externalConversations.length, 1);
    assert.equal(h.externalConversations[0].conversation_id, 500);
    assert.equal(h.externalConversations[0].channel, 'telegram');
    assert.equal(h.externalConversations[0].status, 'open');

    // Message: internal row + external ledger entry.
    assert.equal(h.externalMessages.length, 1);
    assert.equal(h.externalMessages[0].external_message_id, '111');
    assert.equal(h.externalMessages[0].direction, 'inbound');
    assert.equal(h.externalMessages[0].sender_type, 'customer');
    assert.equal(h.externalMessages[0].content, 'Hello, I need help.');

    // Broadcast uses the existing receive_message convention + channel tag.
    assert.equal(h.broadcasts.length, 1);
    const event = h.broadcasts[0].event as Record<string, unknown>;
    assert.equal(event.type, 'receive_message');
    assert.equal(event.channel, 'telegram');
    assert.equal((event.message as Record<string, unknown>).content, 'Hello, I need help.');
  });

  it('reuses the existing contact and conversation for later messages', async () => {
    await h.service.processInbound('telegram', { messages: [makeMessage()] });
    await h.service.processInbound('telegram', {
      messages: [makeMessage({ externalMessageId: '112', content: 'Still here' })],
    });

    assert.equal(h.users.length, 1, 'no second shadow user');
    assert.equal(h.externalConversations.length, 1, 'no second conversation');
    assert.equal(h.externalMessages.length, 2, 'two messages in the same conversation');
  });

  it('prevents duplicate processing of redelivered messages', async () => {
    await h.service.processInbound('telegram', { messages: [makeMessage()] });
    const result = await h.service.processInbound('telegram', { messages: [makeMessage()] });

    assert.deepEqual(result, { processed: 0, ignored: 1 });
    assert.equal(h.externalMessages.length, 1);
    assert.equal(h.broadcasts.length, 1);
  });

  it('rejects an unknown channel', async () => {
    await assert.rejects(
      h.service.processInbound('whatsapp', { messages: [makeMessage()] }),
      /Unknown channel/,
    );
  });

  it('stores a media message with an attachment and broadcasts it', async () => {
    const result = await h.service.processInbound('telegram', {
      messages: [
        makeMessage({
          externalMessageId: '333',
          content: 'Look at this',
          media: {
            kind: 'image',
            fileName: 'photo_333.jpg',
            mimeType: 'image/jpeg',
            fileRef: 'photo1',
          },
        }),
      ],
    });

    assert.deepEqual(result, { processed: 1, ignored: 0 });
    assert.equal(h.attachmentCreates.length, 1);
    assert.ok((h.attachmentCreates[0].file_url as string).startsWith('/uploads/'));
    assert.equal(h.attachmentCreates[0].file_name, 'photo_333.jpg');
    assert.equal(h.attachmentCreates[0].file_type, 'image/jpeg');

    const row = h.externalMessages[0];
    assert.equal(row.direction, 'inbound');
    assert.equal(
      (row.metadata as { media: { kind: string } }).media.kind,
      'image',
    );
  });

  it('dedupes media messages (file downloaded only once)', async () => {
    const messages = [
      makeMessage({
        externalMessageId: '334',
        media: { kind: 'image', fileName: 'p.jpg', mimeType: 'image/jpeg', fileRef: 'photo2' },
      }),
    ];
    await h.service.processInbound('telegram', { messages });
    await h.service.processInbound('telegram', { messages });

    assert.equal(h.externalMessages.length, 1);
    assert.equal(h.attachmentCreates.length, 1, 'file downloaded only once');
  });

  it('records a media message even when the file cannot be downloaded', async () => {
    h = makeHarness({ downloadMedia: async () => null });
    const result = await h.service.processInbound('telegram', {
      messages: [
        makeMessage({
          externalMessageId: '335',
          content: 'Voice message',
          media: { kind: 'voice', fileName: 'voice_335.ogg', mimeType: 'audio/ogg', fileRef: 'voice1' },
        }),
      ],
    });

    assert.deepEqual(result, { processed: 1, ignored: 0 });
    assert.equal(h.attachmentCreates.length, 0, 'no attachment when download fails');
    assert.equal(h.externalMessages.length, 1);
  });

  it('keeps processing the batch when one message fails', async () => {
    h = makeHarness();
    (h.adapter as { parseInbound: unknown }).parseInbound = async () => [
      makeMessage({ externalContactId: 'bad', externalMessageId: 'x' }),
      makeMessage({ externalMessageId: 'ok-1' }),
    ];
    (h.conversationRepo as { create: unknown }).create = async () => {
      throw new Error('db hiccup');
    };

    const result = await h.service.processInbound('telegram', { messages: [] });
    // Both fail (conversation creation throws) but the engine must not crash.
    assert.deepEqual(result, { processed: 0, ignored: 2 });
  });
});

describe('OmniChannelService — agent reply', () => {
  let h: Harness;
  beforeEach(async () => {
    h = makeHarness();
    await h.service.processInbound('telegram', { messages: [makeMessage()] });
  });

  it('delivers through the adapter, persists the outbound message and broadcasts', async () => {
    const reply = await h.service.sendAgentReply(500, 7, 'Hello! How can I help you?');

    assert.ok(reply);
    assert.deepEqual(h.sendCalls[0], {
      chatId: 123456789,
      text: 'Hello! How can I help you?',
      options: { replyToExternalMessageId: null },
    });

    const outbound = h.externalMessages[h.externalMessages.length - 1];
    assert.equal(outbound.direction, 'outbound');
    assert.equal(outbound.sender_type, 'agent');
    assert.equal(outbound.external_message_id, '2222');

    const last = h.broadcasts[h.broadcasts.length - 1];
    assert.equal((last.options as { excludeUserId?: number })?.excludeUserId, 7);
  });

  it('maps an internal reply-to id to the external message id', async () => {
    await h.service.sendAgentReply(500, 7, 'Replying', 700);

    assert.equal(
      (h.sendCalls[0].options as { replyToExternalMessageId?: string })?.replyToExternalMessageId,
      '111',
    );
  });

  it('rejects replying to a non-external conversation', async () => {
    await assert.rejects(
      h.service.sendAgentReply(999, 7, 'Hi'),
      /not an external channel conversation/,
    );
    assert.equal(h.sendCalls.length, 0);
  });

  it('rejects an agent who is not a conversation member', async () => {
    (h.conversationRepo as { isMember: unknown }).isMember = async () => false;
    await assert.rejects(h.service.sendAgentReply(500, 8, 'Hi'), /not a member/);
    assert.equal(h.sendCalls.length, 0);
  });

  it('does not persist anything when the channel rejects the message', async () => {
    h = makeHarness({
      sendMessage: async () => ({ ok: false, description: 'chat not found', errorCode: 400 }),
    });
    await h.service.processInbound('telegram', { messages: [makeMessage()] });

    await assert.rejects(
      h.service.sendAgentReply(500, 7, 'Hello?'),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 502);
        assert.match((error as Error).message, /chat not found/);
        return true;
      },
    );
    assert.equal(h.externalMessages.length, 1, 'only the inbound message persisted');
  });
});

describe('OmniChannelService — assignment + status', () => {
  let h: Harness;
  beforeEach(async () => {
    h = makeHarness();
    await h.service.processInbound('telegram', { messages: [makeMessage()] });
  });

  it('assigns and unassigns an agent, broadcasting the change', async () => {
    const assigned = await h.service.assignAgent(500, 7, 7);
    assert.deepEqual(assigned, { conversationId: 500, assignedAgentId: 7 });
    assert.equal(h.externalConversations[0].assigned_agent_id, 7);
    assert.ok(
      h.broadcasts.some(
        (b) => (b.event as { type?: string }).type === 'omni_assignment_changed',
      ),
    );

    const unassigned = await h.service.assignAgent(500, 7, null);
    assert.deepEqual(unassigned, { conversationId: 500, assignedAgentId: null });
  });

  it('rejects a non-member requester and a non-member assignee', async () => {
    (h.conversationRepo as { isMember: unknown }).isMember = async (
      _convId: number,
      userId: number,
    ) => userId === 7;

    await assert.rejects(h.service.assignAgent(500, 8, 7), /not a member/);
    await assert.rejects(h.service.assignAgent(500, 7, 999), /not a member of this conversation/);
  });

  it('closes and reopens a conversation, reopening on inbound activity', async () => {
    const closed = await h.service.setConversationStatus(500, 7, 'closed');
    assert.deepEqual(closed, { conversationId: 500, status: 'closed' });
    assert.equal(h.externalConversations[0].status, 'closed');
    assert.ok(
      h.broadcasts.some(
        (b) => (b.event as { type?: string }).type === 'omni_conversation_status_changed',
      ),
    );

    // New inbound activity reopens it automatically.
    await h.service.processInbound('telegram', {
      messages: [makeMessage({ externalMessageId: '999' })],
    });
    assert.equal(h.externalConversations[0].status, 'open');
  });

  it('rejects status changes from a non-member', async () => {
    (h.conversationRepo as { isMember: unknown }).isMember = async () => false;
    await assert.rejects(h.service.setConversationStatus(500, 8, 'closed'), /not a member/);
  });
});

describe('OmniChannelService — health', () => {
  it('delegates health to the channel adapter', async () => {
    const h = makeHarness();
    const health = await h.service.getHealth('telegram');
    assert.equal(health.channel, 'telegram');
    assert.equal(health.connected, true);
  });

  it('reports an unknown channel', async () => {
    const h = makeHarness();
    await assert.rejects(h.service.getHealth('whatsapp'), /Unknown channel/);
  });
});