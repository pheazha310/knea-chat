'use strict';

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { TelegramInboxService } from '../src/services/TelegramInbox.service';
import { TelegramApiError } from '../src/integrations/telegram/telegram.service';
import type { TelegramUpdate } from '../src/integrations/telegram/telegram.types';

/** A Telegram update shaped like a real webhook delivery. */
const makeUpdate = (overrides: Partial<TelegramUpdate> = {}): TelegramUpdate => ({
  update_id: 1,
  message: {
    message_id: 111,
    from: {
      id: 123456789,
      is_bot: false,
      first_name: 'John',
      last_name: 'Smith',
      username: 'john123',
    },
    chat: { id: 123456789, type: 'private', first_name: 'John', last_name: 'Smith' },
    date: 1700000000,
    text: 'Hello, I need help.',
  },
  ...overrides,
});

interface Harness {
  service: TelegramInboxService;
  contacts: Map<string, unknown>;
  externalConversations: Array<Record<string, unknown>>;
  externalMessages: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  broadcasts: Array<{ conversationId: number; event: unknown; options?: unknown }>;
  telegramCalls: Array<Record<string, unknown>>;
  attachmentCreates: Array<Record<string, unknown>>;
  conversationRepo: Record<string, unknown>;
  telegramApi: Record<string, unknown>;
}

const deleteField = (obj: object, key: string): void => {
  delete (obj as Record<string, unknown>)[key];
};

// Media tests download files into the shared uploads directory — redirect it
// to a temp folder for this process and clean it up afterwards.
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knea-telegram-test-'));
process.env.UPLOAD_DIR = mediaDir;

after(() => {
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

/** Build a TelegramInboxService with fully in-memory fakes. */
const makeHarness = (): Harness => {
  const contacts = new Map<string, unknown>();
  const externalConversations: Array<Record<string, unknown>> = [];
  const externalMessages: Array<Record<string, unknown>> = [];
  const users: Array<Record<string, unknown>> = [];
  const broadcasts: Array<{ conversationId: number; event: unknown; options?: unknown }> = [];
  const telegramCalls: Array<Record<string, unknown>> = [];

  const externalRepo = {
    findByChannelAndExternalId: async (_channel: string, externalId: string) =>
      contacts.get(externalId) || null,
    createContact: async (data: Record<string, unknown>) => {
      contacts.set(String(data.external_contact_id), {
        id: 1,
        user_id: data.user_id,
        channel: 'telegram',
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
    updateConversationStatus: async () => true,
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
    create: async (data: Record<string, unknown>) => {
      void data;
      return 500;
    },
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

  const telegramApi = {
    isConfigured: () => true,
    getMe: async () => ({ ok: true, result: { id: 1, is_bot: true, first_name: 'Test', username: 'test_bot' } }),
    sendMessage: async (chatId: number, text: string, options?: unknown) => {
      telegramCalls.push({ chatId, text, options });
      return { ok: true, result: { message_id: 2222 } };
    },
    getFile: async (fileId: string) => ({ ok: true, result: { file_id: fileId, file_path: 'photos/photo.jpg' } }),
    downloadFile: async () => Buffer.from('fake-image-bytes'),
  };

  const attachmentCreates: Array<Record<string, unknown>> = [];

  const broadcast = async (
    conversationId: number,
    event: unknown,
    options?: unknown,
  ): Promise<void> => {
    broadcasts.push({ conversationId, event, options });
  };

  const service = new TelegramInboxService(
    telegramApi as never,
    externalRepo as never,
    userRepo as never,
    companyRepo as never,
    conversationRepo as never,
    messageRepo as never,
    messageService as never,
    broadcast as never,
  );

  return {
    service,
    contacts,
    externalConversations,
    externalMessages,
    users,
    broadcasts,
    telegramCalls,
    attachmentCreates,
    conversationRepo,
    telegramApi,
  };
};

describe('TelegramInboxService — webhook flow', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('ignores unsupported updates (no message field) safely', async () => {
    const result = await h.service.handleWebhookUpdate({ update_id: 2, edited_message: { message_id: 1 } as never });
    assert.equal(result, null);
    assert.equal(h.externalMessages.length, 0);
  });

  it('ignores non-text messages', async () => {
    const update = makeUpdate();
    deleteField(update.message as object, 'text');
    const result = await h.service.handleWebhookUpdate(update);
    assert.equal(result, null);
    assert.equal(h.externalMessages.length, 0);
  });

  it('ignores updates missing the sender or chat', async () => {
    const noFrom = makeUpdate();
    deleteField(noFrom.message as object, 'from');
    assert.equal(await h.service.handleWebhookUpdate(noFrom), null);

    const noChat = makeUpdate();
    deleteField(noChat.message as object, 'chat');
    assert.equal(await h.service.handleWebhookUpdate(noChat), null);
    assert.equal(h.externalMessages.length, 0);
  });

  it('creates the contact, conversation and message, then broadcasts', async () => {
    const message = await h.service.handleWebhookUpdate(makeUpdate());

    assert.ok(message);
    assert.equal(message.id, 700);

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
    await h.service.handleWebhookUpdate(makeUpdate());

    const second = makeUpdate({ update_id: 2, message: { ...makeUpdate().message!, message_id: 112, text: 'Still here' } });
    const message = await h.service.handleWebhookUpdate(second);

    assert.ok(message);
    assert.equal(h.users.length, 1, 'no second shadow user');
    assert.equal(h.externalConversations.length, 1, 'no second conversation');
    assert.equal(h.externalMessages.length, 2, 'two messages in the same conversation');
  });

  it('prevents duplicate processing of redelivered updates', async () => {
    await h.service.handleWebhookUpdate(makeUpdate());
    const result = await h.service.handleWebhookUpdate(makeUpdate());

    assert.equal(result, null);
    assert.equal(h.externalMessages.length, 1);
    assert.equal(h.broadcasts.length, 1);
  });

  it('stores a photo message with an attachment and broadcasts it', async () => {
    const photoUpdate = {
      update_id: 30,
      message: {
        message_id: 333,
        from: { id: 123456789, is_bot: false, first_name: 'John', last_name: 'Smith' },
        chat: { id: 123456789, type: 'private' },
        date: 1700000000,
        caption: 'Look at this',
        photo: [{ file_id: 'photo1', file_unique_id: 'u1', width: 100, height: 50, file_size: 123 }],
      },
    };

    const message = await h.service.handleWebhookUpdate(photoUpdate as never);

    assert.ok(message);
    assert.equal(message.type, 'image');
    assert.equal(message.content, 'Look at this');

    // File was downloaded and attached under the uploads directory.
    assert.equal(h.attachmentCreates.length, 1);
    assert.ok((h.attachmentCreates[0].file_url as string).startsWith('/uploads/'));
    assert.equal(h.attachmentCreates[0].file_name, 'photo_333.jpg');
    assert.equal(h.attachmentCreates[0].file_type, 'image/jpeg');

    const row = h.externalMessages[0];
    assert.equal(row.external_message_id, '333');
    assert.equal(row.direction, 'inbound');
    assert.equal(row.sender_type, 'customer');
    assert.equal((row.metadata as { telegram: { media: { kind: string } } }).telegram.media.kind, 'image');

    assert.equal(h.broadcasts.length, 1);
  });

  it('dedupes media updates too', async () => {
    const photoUpdate = {
      update_id: 31,
      message: {
        message_id: 334,
        from: { id: 123456789, is_bot: false, first_name: 'John', last_name: 'Smith' },
        chat: { id: 123456789, type: 'private' },
        date: 1700000000,
        photo: [{ file_id: 'photo2', file_unique_id: 'u2', width: 10, height: 10 }],
      },
    };

    await h.service.handleWebhookUpdate(photoUpdate as never);
    const duplicate = await h.service.handleWebhookUpdate(photoUpdate as never);

    assert.equal(duplicate, null);
    assert.equal(h.externalMessages.length, 1);
    assert.equal(h.attachmentCreates.length, 1, 'file downloaded only once');
  });

  it('records a media message even when the file cannot be downloaded', async () => {
    (h.telegramApi as { getFile: unknown }).getFile = async () => ({
      ok: false,
      description: 'file is too big',
    });

    const voiceUpdate = {
      update_id: 32,
      message: {
        message_id: 335,
        from: { id: 123456789, is_bot: false, first_name: 'John', last_name: 'Smith' },
        chat: { id: 123456789, type: 'private' },
        date: 1700000000,
        voice: { file_id: 'voice1', file_unique_id: 'uv', duration: 4, mime_type: 'audio/ogg' },
      },
    };

    const message = await h.service.handleWebhookUpdate(voiceUpdate as never);

    assert.ok(message);
    assert.equal(message.type, 'voice');
    assert.equal(h.attachmentCreates.length, 0, 'no attachment when download fails');
    assert.equal(h.externalMessages.length, 1);
  });
});

describe('TelegramInboxService — contact logic', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('findOrCreateTelegramContact creates a contact on first sight', async () => {
    const contact = await h.service.findOrCreateContact({
      id: 987654321,
      is_bot: false,
      first_name: 'Jane',
      last_name: 'Doe',
      username: 'jane_doe',
    });

    assert.equal(contact.external_contact_id, '987654321');
    assert.equal(contact.username, 'jane_doe');
    assert.equal(contact.first_name, 'Jane');
    assert.equal(h.contacts.size, 1);
  });

  it('findOrCreateTelegramContact returns the existing contact and creates no shadow user', async () => {
    await h.service.findOrCreateContact({ id: 555, is_bot: false, first_name: 'Ann' });
    const before = h.users.length;

    const again = await h.service.findOrCreateContact({ id: 555, is_bot: false, first_name: 'Ann' });

    assert.equal(again.external_contact_id, '555');
    assert.equal(h.users.length, before);
  });
});

describe('TelegramInboxService — conversation logic', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('creates one conversation per contact and reuses it', async () => {
    const contact = await h.service.findOrCreateContact({ id: 1, is_bot: false, first_name: 'A' });
    await h.service.findOrCreateConversation(contact);
    await h.service.findOrCreateConversation(contact);

    assert.equal(h.externalConversations.length, 1);
  });
});

describe('TelegramInboxService — agent assignment', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('assigns and unassigns an agent, broadcasting the change', async () => {
    await h.service.handleWebhookUpdate(makeUpdate());

    const assigned = await h.service.assignAgent(500, 7, 7);
    assert.deepEqual(assigned, { conversationId: 500, assignedAgentId: 7 });
    assert.equal(h.externalConversations[0].assigned_agent_id, 7);
    assert.ok(
      h.broadcasts.some(
        (b) => (b.event as { type?: string }).type === 'telegram_assignment_changed',
      ),
    );

    const unassigned = await h.service.assignAgent(500, 7, null);
    assert.deepEqual(unassigned, { conversationId: 500, assignedAgentId: null });
    assert.equal(h.externalConversations[0].assigned_agent_id, null);
  });

  it('rejects assignment on a non-Telegram conversation', async () => {
    await assert.rejects(h.service.assignAgent(999, 7, 7), /not a Telegram conversation/);
  });

  it('rejects a non-member requester and a non-member assignee', async () => {
    await h.service.handleWebhookUpdate(makeUpdate());
    (h.conversationRepo as { isMember: unknown }).isMember = async (
      _convId: number,
      userId: number,
    ) => userId === 7;

    await assert.rejects(h.service.assignAgent(500, 8, 7), /not a member/);
    await assert.rejects(h.service.assignAgent(500, 7, 999), /not a member of this conversation/);
  });
});

describe('TelegramInboxService — agent reply', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('sends to Telegram, persists the outbound message and broadcasts', async () => {
    // Seed an external conversation (created by a prior inbound message).
    await h.service.handleWebhookUpdate(makeUpdate());

    const reply = await h.service.sendAgentReply(7, 500, 'Hello! How can I help you?');

    assert.ok(reply);
    // Chat id is resolved from the stored contact, not the client.
    assert.deepEqual(h.telegramCalls[0], {
      chatId: 123456789,
      text: 'Hello! How can I help you?',
      options: {},
    });

    const outbound = h.externalMessages[h.externalMessages.length - 1];
    assert.equal(outbound.direction, 'outbound');
    assert.equal(outbound.sender_type, 'agent');
    assert.equal(outbound.external_message_id, '2222');

    // Broadcast excludes the replying agent (they get the REST response).
    assert.equal(h.broadcasts.length, 2);
    const last = h.broadcasts[h.broadcasts.length - 1];
    assert.equal((last.options as { excludeUserId?: number })?.excludeUserId, 7);
  });

  it('rejects replying to a non-Telegram conversation', async () => {
    await assert.rejects(
      h.service.sendAgentReply(7, 999, 'Hi'),
      /not a Telegram conversation/,
    );
    assert.equal(h.telegramCalls.length, 0);
  });

  it('rejects an agent who is not a conversation member', async () => {
    await h.service.handleWebhookUpdate(makeUpdate());
    (h.conversationRepo as { isMember: unknown }).isMember = async () => false;

    await assert.rejects(h.service.sendAgentReply(8, 500, 'Hi'), /not a member/);
    assert.equal(h.telegramCalls.length, 0);
  });

  it('maps an internal reply-to id to the Telegram message id', async () => {
    await h.service.handleWebhookUpdate(makeUpdate());

    await h.service.sendAgentReply(7, 500, 'Replying to your message', 700);

    assert.equal(h.telegramCalls.length, 1);
    assert.deepEqual(h.telegramCalls[0].options, { reply_to_message_id: 111 });
  });

  it('does not persist anything when Telegram rejects the message', async () => {
    await h.service.handleWebhookUpdate(makeUpdate());
    (h.telegramApi as { sendMessage: unknown }).sendMessage = async () => ({
      ok: false,
      description: 'bot was blocked by the user',
      error_code: 403,
    });

    await assert.rejects(
      h.service.sendAgentReply(7, 500, 'Hello?'),
      (error: unknown) => {
        assert.ok(error instanceof TelegramApiError);
        assert.match((error as Error).message, /blocked by the user/);
        return true;
      },
    );
    // Only the inbound message exists — the failed reply was never persisted.
    assert.equal(h.externalMessages.length, 1);
    assert.equal(h.externalMessages[0].direction, 'inbound');
  });
});