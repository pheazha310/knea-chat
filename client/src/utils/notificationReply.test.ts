/// <reference types="jest" />
import { messageTargetOf } from './notificationReply';
import type { Notification } from '../models';

const base = (overrides: Partial<Notification>): Notification => ({
  id: 1,
  user_id: 2,
  type: 'mention',
  title: 'Maya mentioned you',
  data: { conversationId: 7, messageId: 42 },
  is_read: 0,
  created_at: '2026-09-05T10:00:00Z',
  ...overrides,
});

describe('messageTargetOf', () => {
  it('resolves mention notifications with object data', () => {
    expect(messageTargetOf(base({}))).toEqual({
      conversationId: 7,
      messageId: 42,
    });
  });

  it('resolves new_message notifications', () => {
    expect(
      messageTargetOf(base({ type: 'new_message' })),
    ).toEqual({ conversationId: 7, messageId: 42 });
  });

  it('parses data arriving as a JSON string (MySQL JSON column)', () => {
    expect(
      messageTargetOf(
        base({ data: JSON.stringify({ conversationId: 7, messageId: 42 }) }),
      ),
    ).toEqual({ conversationId: 7, messageId: 42 });
  });

  it('returns null for non-message notification types', () => {
    for (const type of [
      'missed_call',
      'announcement',
      'meeting_invite',
      'task_assigned',
      'task_deadline',
      'message_reminder',
    ]) {
      expect(
        messageTargetOf(base({ type, data: { conversationId: 7, messageId: 42 } })),
      ).toBeNull();
    }
  });

  it('returns null when the message id is missing or invalid', () => {
    expect(messageTargetOf(base({ data: { conversationId: 7 } }))).toBeNull();
    expect(
      messageTargetOf(base({ data: { conversationId: 7, messageId: 'nope' } })),
    ).toBeNull();
  });

  it('returns null when data is unparseable', () => {
    expect(messageTargetOf(base({ data: 'not json {' }))).toBeNull();
    expect(messageTargetOf(base({ data: null }))).toBeNull();
  });
});
