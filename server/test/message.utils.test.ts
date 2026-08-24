'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { serializeMessage } from '../src/websocket/message.utils';
import type { OutgoingMessage } from '../src/types';

const RAW_MESSAGE: OutgoingMessage = {
  id: 42,
  conversation_id: 7,
  sender_id: 5,
  email: 'maya@kneachat.com',
  first_name: 'Maya',
  last_name: 'Chen',
  profile_picture: '/uploads/maya.png',
  content: 'Hello team!',
  type: 'text',
  reply_to: 10,
  created_at: '2026-08-12T10:00:00Z',
  updated_at: '2026-08-12T10:05:00Z',
  is_pinned: 1,
  deleted_at: null,
  reactions: [
    { id: 1, message_id: 42, user_id: 5, reaction: '🎉', created_at: '2026-08-12T10:00:00Z' },
  ],
  attachments: [
    {
      id: 1,
      message_id: 42,
      file_name: 'doc.pdf',
      file_url: '/uploads/doc.pdf',
      file_type: 'application/pdf',
      file_size: 1024,
      uploaded_at: '2026-08-12T10:00:00Z',
    },
  ],
  mentionedUserIds: [2, 3],
};

describe('websocket message.utils — serializeMessage', () => {
  it('maps snake_case DB fields to the camelCase client event shape', () => {
    const serialized = serializeMessage(RAW_MESSAGE);

    assert.equal(serialized.id, 42);
    assert.equal(serialized.conversationId, 7);
    assert.equal(serialized.senderId, 5);
    assert.equal(serialized.senderEmail, 'maya@kneachat.com');
    assert.equal(serialized.senderFirstName, 'Maya');
    assert.equal(serialized.senderLastName, 'Chen');
    assert.equal(serialized.senderProfilePicture, '/uploads/maya.png');
    assert.equal(serialized.content, 'Hello team!');
    assert.equal(serialized.messageType, 'text');
    assert.equal(serialized.replyTo, 10);
    assert.equal(serialized.createdAt, '2026-08-12T10:00:00Z');
    assert.equal(serialized.updatedAt, '2026-08-12T10:05:00Z');
    assert.equal(serialized.deletedAt, null);
  });

  it('passes through reactions, attachments and mentionedUserIds', () => {
    const serialized = serializeMessage(RAW_MESSAGE);
    assert.deepEqual(serialized.reactions, RAW_MESSAGE.reactions);
    assert.deepEqual(serialized.attachments, RAW_MESSAGE.attachments);
    assert.deepEqual(serialized.mentionedUserIds, [2, 3]);
  });

  it('coerces is_pinned to a boolean', () => {
    assert.equal(serializeMessage({ ...RAW_MESSAGE, is_pinned: 1 }).isPinned, true);
    assert.equal(serializeMessage({ ...RAW_MESSAGE, is_pinned: 0 }).isPinned, false);
    assert.equal(serializeMessage({ ...RAW_MESSAGE, is_pinned: undefined as unknown as number }).isPinned, false);
  });

  it('provides safe defaults for missing optional fields', () => {
    const serialized = serializeMessage({
      id: 1,
      conversation_id: 2,
      sender_id: 3,
      content: 'x',
      type: 'text',
      created_at: 't',
    } as unknown as OutgoingMessage);

    assert.deepEqual(serialized.reactions, []);
    assert.deepEqual(serialized.attachments, []);
    assert.deepEqual(serialized.mentionedUserIds, []);
    assert.equal(serialized.isPinned, false);
  });
});
