'use strict';

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { seed } from '../test-helpers/module-stub';

const bookmarkModel = {
  create: async (_data: unknown) => 1,
  remove: async () => true,
  findByMessage: async () => [],
  findByUser: async () => [],
  exists: async () => false,
};

const messageModel = {
  findById: async (id: number) => ({ id, conversation_id: 7, type: 'direct', name: null }),
};

const conversationModel = {
  findById: async (id: number) => ({ id, type: 'direct', name: null }),
  isMember: async () => true,
  canAccessTeamConversation: async () => true,
};

seed('../src/repositories/bookmarkRepository', bookmarkModel);
seed('../src/repositories/messageRepository', messageModel);
seed('../src/repositories/conversationRepository', conversationModel);

const { BookmarkService } = require('../src/services/Bookmark.service');
const { BookmarkRepository } = require('../src/repositories/bookmarkRepository');
const { MessageRepository } = require('../src/repositories/messageRepository');
const { ConversationRepository } = require('../src/repositories/conversationRepository');

const bookmarkService = new BookmarkService(
  bookmarkModel as unknown as typeof BookmarkRepository,
  messageModel as unknown as typeof MessageRepository,
  conversationModel as unknown as typeof ConversationRepository,
);

beforeEach(() => {
  bookmarkModel.create = async (_data: unknown) => 1;
  bookmarkModel.remove = async () => true;
  bookmarkModel.exists = async () => false;
  (messageModel as any).findById = async (id: number) => ({ id, conversation_id: 7, type: 'direct', name: null });
  (conversationModel as any).isMember = async () => true;
  (conversationModel as any).canAccessTeamConversation = async () => true;
});

after(() => {
  // Nothing to clean up — each test file runs in its own process.
});

describe('BookmarkService', () => {
  it('throws when the message does not exist', async () => {
    (messageModel as any).findById = async () => null;
    await assert.rejects(
      bookmarkService.bookmark(1, 1),
      /Message not found/,
    );
  });

  it('throws when the user is not a conversation member', async () => {
    (conversationModel as any).isMember = async () => false;
    await assert.rejects(
      bookmarkService.bookmark(1, 1),
      /not a member of this conversation/,
    );
  });

  it('creates a bookmark and returns it', async () => {
    (bookmarkModel as any).findByMessage = async () => [{ id: 1, message_id: 1, user_id: 1, created_at: new Date() }];
    const result = await bookmarkService.bookmark(1, 1);
    assert.equal(result.message_id, 1);
    assert.equal(result.user_id, 1);
  });

  it('removes a bookmark', async () => {
    const result = await bookmarkService.unbookmark(1, 1);
    assert.equal(result.removed, true);
  });

  it('returns the user bookmarks', async () => {
    (bookmarkModel as any).findByUser = async () => [{ id: 1, message_id: 1, user_id: 1 }];
    const bookmarks = await bookmarkService.getUserBookmarks(1);
    assert.ok(Array.isArray(bookmarks));
  });

  it('checks if a message is bookmarked', async () => {
    const exists = await bookmarkService.isBookmarked(1, 1);
    assert.equal(exists, false);
  });
});
