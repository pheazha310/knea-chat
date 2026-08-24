'use strict';

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { seed } from '../test-helpers/module-stub';
import { MessageService } from '../src/services/Message.service';
import type { MessageRepository } from '../src/repositories/messageRepository';
import type { ConversationRepository } from '../src/repositories/conversationRepository';
import type { NotificationRepository } from '../src/repositories/notificationRepository';
import type { ReactionRepository } from '../src/repositories/reactionRepository';
import type { OutgoingMessage } from '../src/types';

const MEMBERS = [
  { id: 1, first_name: 'Ann', last_name: 'Admin', email: 'ann@kneachat.com' },
  { id: 2, first_name: 'Maya', last_name: 'Chen', email: 'maya@kneachat.com' },
  { id: 3, first_name: 'Dara', last_name: 'Sok', email: 'dara@kneachat.com' },
];

const baseMessage = (overrides: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  id: 42,
  conversation_id: 7,
  sender_id: 1,
  content: 'Hello',
  type: 'text',
  reply_to: null,
  forwarded_from: null,
  created_at: '2026-08-12T10:00:00Z',
  updated_at: '2026-08-12T10:00:00Z',
  is_pinned: 0,
  deleted_at: null,
  first_name: 'Ann',
  last_name: 'Admin',
  email: 'ann@kneachat.com',
  profile_picture: null,
  ...overrides,
});

const messageModel = {
  create: async (data: unknown) => 42,
  createAttachment: async (data: unknown) => 1,
  findByIdWithSender: async (id: number) => baseMessage({ id }),
  findById: async (id: number) => baseMessage({ id }),
  update: async () => true,
  softDelete: async () => true,
  setPinned: async () => true,
  findReactions: async () => [],
  findAttachments: async () => [],
  findAll: async () => [],
  search: async () => [],
};

const conversationModel = {
  findById: async (id: number) => ({ id, type: 'direct', name: null }),
  isMember: async () => true,
  findMembers: async () => MEMBERS,
  findMemberIds: async () => MEMBERS.map((m) => m.id),
  canAccessTeamConversation: async () => true,
};

const notificationModel = {
  creates: [] as Array<Record<string, unknown>>,
  create: async (data: Record<string, unknown>) => {
    notificationModel.creates.push(data);
    return 1;
  },
};

const reactionModel = {
  add: async () => true,
  remove: async () => true,
};

seed('../src/repositories/messageRepository', messageModel);
seed('../src/repositories/conversationRepository', conversationModel);
seed('../src/repositories/notificationRepository', notificationModel);
seed('../src/repositories/reactionRepository', reactionModel);

const messageService = new MessageService(
  messageModel as unknown as MessageRepository,
  reactionModel as unknown as ReactionRepository,
  conversationModel as unknown as ConversationRepository,
  notificationModel as unknown as NotificationRepository,
);

beforeEach(() => {
  notificationModel.creates = [];
});

after(() => {
  // Nothing to clean up — each test file runs in its own process.
});

describe('MessageService.createMessage', () => {
  it('throws when the conversation does not exist', async (t) => {
    t.mock.method(conversationModel, 'findById', async () => null);
    await assert.rejects(
      messageService.createMessage({ conversation_id: 999, sender_id: 1, content: 'Hi' }),
      /Conversation not found/,
    );
  });

  it('throws when the sender is not a conversation member', async (t) => {
    t.mock.method(conversationModel, 'isMember', async () => false);
    await assert.rejects(
      messageService.createMessage({ conversation_id: 7, sender_id: 1, content: 'Hi' }),
      /not a member of this conversation/,
    );
  });

  it('rejects a non-member sending into a team conversation', async (t) => {
    t.mock.method(conversationModel, 'findById', async (id: number) => ({ id, type: 'team', name: 'Engineering' }));
    t.mock.method(conversationModel, 'canAccessTeamConversation', async () => false);
    const create = t.mock.method(messageModel, 'create', async (data: unknown) => 42);

    await assert.rejects(
      messageService.createMessage({ conversation_id: 7, sender_id: 1, content: 'Hi' }),
      /must be a member of this team/,
    );
    assert.equal(create.mock.calls.length, 0);
  });

  it('lets a team member send into a team conversation', async (t) => {
    t.mock.method(conversationModel, 'findById', async (id: number) => ({ id, type: 'team', name: 'Engineering' }));
    t.mock.method(conversationModel, 'canAccessTeamConversation', async () => true);
    const create = t.mock.method(messageModel, 'create', async (data: unknown) => 42);

    const message = await messageService.createMessage({ conversation_id: 7, sender_id: 1, content: 'Hi' });

    assert.equal(create.mock.calls.length, 1);
    assert.equal(message.id, 42);
  });

  it('persists the message and returns it with mentions + mention notifications', async (t) => {
    const content = 'Hi @Maya Chen and @Dara Sok!';
    const create = t.mock.method(messageModel, 'create', async (data: unknown) => 42);

    const message = await messageService.createMessage({
      conversation_id: 7,
      sender_id: 1,
      content,
      type: 'text',
      reply_to: 5,
    });

    assert.deepEqual(create.mock.calls[0].arguments[0], {
      conversation_id: 7,
      sender_id: 1,
      content,
      type: 'text',
      reply_to: 5,
      forwarded_from: undefined,
    });
    assert.equal(message.id, 42);
    assert.deepEqual(message.mentionedUserIds, [2, 3]);

    // Sender is not mentioned; every other member is → no new_message rows.
    assert.deepEqual(message.notifiedUserIds, []);

    const mentionRows = notificationModel.creates.filter((n) => n.type === 'mention');
    assert.equal(mentionRows.length, 2);
    assert.deepEqual(
      mentionRows.map((n) => n.user_id).sort(),
      [2, 3],
    );
    for (const row of mentionRows) {
      assert.equal(row.actor_id, 1);
      assert.equal(row.title, 'Ann Admin mentioned you');
      assert.deepEqual(row.data, { conversationId: 7, messageId: 42 });
    }
  });

  it('creates new_message notifications for non-mentioned members only', async () => {
    const message = await messageService.createMessage({
      conversation_id: 7,
      sender_id: 1,
      content: 'Plain update, no mentions',
    });

    assert.deepEqual(message.mentionedUserIds, []);
    assert.deepEqual(message.notifiedUserIds, [2, 3]);

    const newMessageRows = notificationModel.creates.filter((n) => n.type === 'new_message');
    assert.equal(newMessageRows.length, 2);
    assert.deepEqual(newMessageRows.map((n) => n.user_id).sort(), [2, 3]);
    for (const row of newMessageRows) {
      assert.equal(row.title, 'Ann Admin');
      assert.equal(row.message, 'Plain update, no mentions');
    }
  });
});

describe('MessageService.createFileMessage', () => {
  it('persists the message row + attachment and returns a file message', async (t) => {
    const file = {
      file_name: 'design.pdf',
      file_url: '/uploads/design.pdf',
      file_type: 'application/pdf',
      file_size: 1024,
    };
    const create = t.mock.method(messageModel, 'create', async (data: unknown) => 99);
    const createAttachment = t.mock.method(messageModel, 'createAttachment', async (data: unknown) => 1);

    const message = await messageService.createFileMessage({
      conversation_id: 7,
      sender_id: 1,
      file,
    });

    assert.deepEqual(create.mock.calls[0].arguments[0], {
      conversation_id: 7,
      sender_id: 1,
      content: 'design.pdf',
      type: 'file',
      reply_to: null,
    });

    assert.equal(createAttachment.mock.calls.length, 1);
    assert.deepEqual(createAttachment.mock.calls[0].arguments[0], {
      message_id: 99,
      file_name: 'design.pdf',
      file_url: '/uploads/design.pdf',
      file_type: 'application/pdf',
      file_size: 1024,
    });

    assert.equal(message.id, 99);
    assert.deepEqual(message.mentionedUserIds, []);
    assert.deepEqual(message.notifiedUserIds, [2, 3]);
    assert.equal(notificationModel.creates.filter((n) => n.type === 'new_message').length, 2);
  });
});

describe('MessageService.createMessageNotifications', () => {
  it('never throws when the notification insert fails (delivery first)', async (t) => {
    t.mock.method(notificationModel, 'create', async () => {
      throw new Error('db hiccup');
    });

    const notified = await messageService.createMessageNotifications(
      baseMessage(),
      1,
      7,
      'hello',
      [],
    );
    assert.ok(Array.isArray(notified));
  });

  it('truncates long snippets to 120 chars with an ellipsis', async () => {
    const long = 'x'.repeat(150);
    await messageService.createMessageNotifications(baseMessage(), 1, 7, long, []);
    const rows = notificationModel.creates.filter((n) => n.type === 'new_message');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].message, `${'x'.repeat(120)}…`);
  });
});

describe('MessageService.createMentionNotifications', () => {
  it('does nothing when no one is mentioned', async (t) => {
    const create = t.mock.method(notificationModel, 'create', async () => 1);
    await messageService.createMentionNotifications(baseMessage(), 1, 7, 'hi', []);
    assert.equal(create.mock.calls.length, 0);
  });

  it('creates one mention notification per mentioned user', async (t) => {
    const create = t.mock.method(notificationModel, 'create', async (data: Record<string, unknown>) => 1);
    await messageService.createMentionNotifications(baseMessage(), 1, 7, 'hi', [2, 3]);
    assert.equal(create.mock.calls.length, 2);
    for (const call of create.mock.calls) {
      assert.equal(call.arguments[0].type, 'mention');
    }
  });

  it('skips a self-mention', async (t) => {
    const create = t.mock.method(notificationModel, 'create', async (data: Record<string, unknown>) => 1);
    await messageService.createMentionNotifications(baseMessage(), 1, 7, 'hi', [1, 2]);
    assert.equal(create.mock.calls.length, 1);
    assert.equal(create.mock.calls[0].arguments[0].user_id, 2);
  });
});

describe('MessageService.updateMessage', () => {
  it('throws when the message does not exist', async (t) => {
    t.mock.method(messageModel, 'findById', async () => null);
    await assert.rejects(messageService.updateMessage(1, 'x', 1), /Message not found/);
  });

  it('throws when a different user tries to edit', async (t) => {
    t.mock.method(messageModel, 'findById', async () => baseMessage({ sender_id: 9 }));
    await assert.rejects(messageService.updateMessage(42, 'x', 1), /only edit your own messages/);
  });

  it('updates content and returns the refreshed message', async (t) => {
    const update = t.mock.method(messageModel, 'update', async () => true);
    t.mock.method(messageModel, 'findById', async (id: number) => baseMessage({ id, content: 'edited' }));

    const message = await messageService.updateMessage(42, 'edited', 1);

    assert.deepEqual(update.mock.calls[0].arguments, [42, 'edited']);
    assert.equal(message.content, 'edited');
  });
});

describe('MessageService.deleteMessage', () => {
  it('throws when the message does not exist', async (t) => {
    t.mock.method(messageModel, 'findById', async () => null);
    await assert.rejects(messageService.deleteMessage(1, 1), /Message not found/);
  });

  it('throws when a different user tries to delete', async (t) => {
    t.mock.method(messageModel, 'findById', async () => baseMessage({ sender_id: 9 }));
    await assert.rejects(messageService.deleteMessage(42, 1), /only delete your own messages/);
  });

  it('soft-deletes and returns the deleted message', async (t) => {
    const softDelete = t.mock.method(messageModel, 'softDelete', async () => true);
    const result = await messageService.deleteMessage(42, 1);
    assert.deepEqual(softDelete.mock.calls[0].arguments, [42]);
    assert.equal(result.deletedMessage.id, 42);
    assert.equal(result.message, 'Message deleted successfully');
  });
});

describe('MessageService.pinMessage / unpinMessage', () => {
  it('throws when the message does not exist', async (t) => {
    t.mock.method(messageModel, 'findById', async () => null);
    await assert.rejects(messageService.pinMessage(1, 1), /Message not found/);
  });

  it('throws when the user is not a conversation member', async (t) => {
    t.mock.method(conversationModel, 'isMember', async () => false);
    await assert.rejects(messageService.pinMessage(42, 1), /not a member of this conversation/);
  });

  it('pins the message', async (t) => {
    const setPinned = t.mock.method(messageModel, 'setPinned', async () => true);
    const message = await messageService.pinMessage(42, 1);
    assert.deepEqual(setPinned.mock.calls[0].arguments, [42, true]);
    assert.equal(message.id, 42);
  });

  it('unpins the message', async (t) => {
    const setPinned = t.mock.method(messageModel, 'setPinned', async () => true);
    await messageService.unpinMessage(42, 1);
    assert.deepEqual(setPinned.mock.calls[0].arguments, [42, false]);
  });
});

describe('MessageService.addReaction / removeReaction', () => {
  it('throws when the message does not exist', async (t) => {
    t.mock.method(messageModel, 'findById', async () => null);
    await assert.rejects(messageService.addReaction(1, 1, '🎉'), /Message not found/);
  });

  it('throws when the user is not a member', async (t) => {
    t.mock.method(conversationModel, 'isMember', async () => false);
    await assert.rejects(messageService.addReaction(42, 1, '🎉'), /not a member/);
  });

  it('is idempotent when the reaction already exists (no duplicate-key 400)', async (t) => {
    // A client with stale local state re-POSTs a reaction it already placed;
    // the endpoint must succeed and return the current list, not error.
    t.mock.method(reactionModel, 'add', async () => null);
    const result = await messageService.addReaction(42, 1, '🎉');
    assert.equal(result.conversationId, 7);
    assert.deepEqual(result.reactions, []);
  });

  it('adds a reaction and returns the conversation id + updated reaction list', async (t) => {
    const reactions = [{ reaction: '🎉', user_id: 1 }];
    t.mock.method(messageModel, 'findReactions', async () => reactions);
    const added = await messageService.addReaction(42, 1, '🎉');
    assert.equal(added.conversationId, 7);
    assert.deepEqual(added.reactions, reactions);
  });

  it('is idempotent when removing a reaction that does not exist', async (t) => {
    t.mock.method(reactionModel, 'remove', async () => false);
    const result = await messageService.removeReaction(42, 1, '👍');
    assert.equal(result.conversationId, 7);
    assert.deepEqual(result.reactions, []);
  });
});

describe('MessageService.getMessages', () => {
  it('throws for a non-member when a userId is provided', async (t) => {
    t.mock.method(conversationModel, 'isMember', async () => false);
    await assert.rejects(messageService.getMessages(7, 1, 30, 1), /not a member/);
  });

  it('rejects fetching team conversation messages without team access', async (t) => {
    t.mock.method(conversationModel, 'findById', async (id: number) => ({ id, type: 'team', name: 'Engineering' }));
    t.mock.method(conversationModel, 'canAccessTeamConversation', async () => false);

    await assert.rejects(messageService.getMessages(7, 1, 30, 1), /must be a member of this team/);
  });

  it('skips the membership check when no userId is provided', async (t) => {
    const isMember = t.mock.method(conversationModel, 'isMember', async () => true);
    await messageService.getMessages(7, 1, 30, null);
    assert.equal(isMember.mock.calls.length, 0);
  });

  it('attaches reactions and attachments to every message', async (t) => {
    t.mock.method(messageModel, 'findAll', async () => [baseMessage({ id: 1 }), baseMessage({ id: 2 })]);
    t.mock.method(messageModel, 'findReactions', async () => [{ reaction: '👍' }]);
    t.mock.method(messageModel, 'findAttachments', async () => [{ id: 9 }]);

    const messages = await messageService.getMessages(7, 1, 30, 1);

    assert.equal(messages.length, 2);
    assert.deepEqual(messages[0].reactions, [{ reaction: '👍' }]);
    assert.deepEqual(messages[0].attachments, [{ id: 9 }]);
    assert.deepEqual(messages[1].reactions, [{ reaction: '👍' }]);
  });
});
