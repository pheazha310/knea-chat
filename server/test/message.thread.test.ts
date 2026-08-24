'use strict';

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { seed } from '../test-helpers/module-stub';

const messageModel = {
  findById: async (id: number) => ({ id, conversation_id: 7, type: 'direct', name: null }),
  findByIdWithSender: async (id: number) => ({ id, conversation_id: 7, type: 'direct', name: null }),
  findThreadReplies: async () => [],
  findReactions: async () => [],
  findAttachments: async () => [],
};

const conversationModel = {
  findById: async (id: number) => ({ id, type: 'direct', name: null }),
  isMember: async () => true,
  canAccessTeamConversation: async () => true,
};

const notificationModel = {
  create: async () => 1,
};

const reactionModel = {
  add: async () => true,
  remove: async () => true,
};

seed('../src/repositories/messageRepository', messageModel);
seed('../src/repositories/conversationRepository', conversationModel);
seed('../src/repositories/notificationRepository', notificationModel);
seed('../src/repositories/reactionRepository', reactionModel);

const { MessageService } = require('../src/services/Message.service');
const { MessageRepository } = require('../src/repositories/messageRepository');
const { ConversationRepository } = require('../src/repositories/conversationRepository');
const { NotificationRepository } = require('../src/repositories/notificationRepository');
const { ReactionRepository } = require('../src/repositories/reactionRepository');

const messageService = new MessageService(
  messageModel as unknown as typeof MessageRepository,
  reactionModel as unknown as typeof ReactionRepository,
  conversationModel as unknown as typeof ConversationRepository,
  notificationModel as unknown as typeof NotificationRepository,
);

beforeEach(() => {
  messageModel.findThreadReplies = async () => [];
  (messageModel as any).findById = async (id: number) => ({ id, conversation_id: 7, type: 'direct', name: null });
});

after(() => {
  // Nothing to clean up — each test file runs in its own process.
});

describe('MessageService.getThreadReplies', () => {
  it('throws when the message does not exist', async () => {
    (messageModel as any).findById = async () => null;
    await assert.rejects(
      messageService.getThreadReplies(1, 1, 30, 1),
      /Message not found/,
    );
  });

  it('returns the parent and replies with reactions/attachments', async () => {
    (messageModel as any).findThreadReplies = async () => [
      { id: 2, conversation_id: 7, reply_to: 1, content: 'Reply', type: 'text', sender_id: 2, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', is_pinned: 0, deleted_at: null },
    ];
    (messageModel as any).findByIdWithSender = async (id: number) => ({ id, conversation_id: 7, type: 'direct', name: null });
    const thread = await messageService.getThreadReplies(1, 1, 30, 1);
    assert.equal(thread.parent.id, 1);
    assert.ok(Array.isArray(thread.replies));
    assert.equal(thread.replies.length, 1);
    assert.equal(thread.replies[0].id, 2);
  });
});
