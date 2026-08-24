'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { seed } from '../test-helpers/module-stub';
import { ReminderService } from '../src/services/Reminder.service';
import { ReminderController } from '../src/controllers/reminder.controller';
import type { ReminderRepository } from '../src/repositories/reminderRepository';
import type { NotificationRepository } from '../src/repositories/notificationRepository';
import type { MessageRepository } from '../src/repositories/messageRepository';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const messageModel = {
  findById: async (id: number) => {
    if (id === 999) return null;
    return { id, conversation_id: 1, sender_id: 1, content: 'Hello' };
  },
  findByIdWithSender: async (id: number) => {
    if (id === 999) return null;
    return {
      id,
      conversation_id: 1,
      sender_id: 1,
      content: 'Hello',
      first_name: 'Ann',
      last_name: 'Admin',
    };
  },
};

const reminderModel = {
  create: async (data: { message_id: number; user_id: number; remind_at: Date | string }) => 42,
  findByMessageAndUser: async (messageId: number, userId: number) => {
    // Message 200 already has a reminder for user 1
    if (messageId === 200 && userId === 1) {
      return { id: 10, message_id: 200, user_id: 1, remind_at: new Date(), is_sent: 0, created_at: new Date() };
    }
    return null;
  },
  findDueReminders: async () => [],
  markAsSent: async () => {},
  delete: async () => true,
};

const notificationModel = {
  create: async () => 1,
};

seed('../src/repositories/messageRepository', messageModel);
seed('../src/repositories/reminderRepository', reminderModel);
seed('../src/repositories/notificationRepository', notificationModel);

// Stub sendToUser so the processDueReminders test doesn't require a real WS connection.
seed('../src/websocket/connection.registry', { sendToUser: () => {} });

const reminderService = new ReminderService(
  reminderModel as unknown as ReminderRepository,
  notificationModel as unknown as NotificationRepository,
  messageModel as unknown as MessageRepository,
);

const reminderController = new ReminderController(reminderService);

// ---------------------------------------------------------------------------
// Helpers — mock Express req / res
// ---------------------------------------------------------------------------

const mockReq = (params: Record<string, string> = {}, userId = 1) =>
  ({ params, user: { id: userId } }) as any;

const mockRes = () => {
  const res: any = {};
  res.status = (code: number) => { res._status = code; return res; };
  res.json = (body: unknown) => { res._body = body; return res; };
  return res;
};

// ---------------------------------------------------------------------------
// ReminderService
// ---------------------------------------------------------------------------

describe('ReminderService.getMyReminder', () => {
  it('returns null when the message exists but has no reminder', async () => {
    const result = await reminderService.getMyReminder(1, 1);
    assert.equal(result, null);
  });

  it('returns reminder data when the message has an active reminder', async () => {
    const result = await reminderService.getMyReminder(200, 1);
    assert.ok(result);
    assert.equal(result.id, 10);
    assert.ok(result.remind_at);
  });

  it('throws "Message not found" for a non-existent message', async () => {
    await assert.rejects(
      reminderService.getMyReminder(999, 1),
      /Message not found/,
    );
  });
});

describe('ReminderService.setReminder', () => {
  it('throws "Message not found" when the message does not exist', async () => {
    await assert.rejects(
      reminderService.setReminder({ messageId: 999, userId: 1, remindAt: new Date() }),
      /Message not found/,
    );
  });

  it('creates a reminder and returns the id', async () => {
    const result = await reminderService.setReminder({
      messageId: 1,
      userId: 1,
      remindAt: new Date(),
    });
    assert.equal(result.id, 42);
  });
});

describe('ReminderService.cancelReminder', () => {
  it('throws "Message not found" when the message does not exist', async () => {
    await assert.rejects(
      reminderService.cancelReminder(999, 1),
      /Message not found/,
    );
  });

  it('returns false when no reminder exists to cancel', async () => {
    const result = await reminderService.cancelReminder(1, 1);
    assert.equal(result, false);
  });

  it('deletes and returns true when a reminder exists', async () => {
    const result = await reminderService.cancelReminder(200, 1);
    assert.equal(result, true);
  });
});

describe('ReminderService.processDueReminders', () => {
  it('does nothing when there are no due reminders', async () => {
    // findDueReminders already returns []
    await reminderService.processDueReminders(new Date());
    // No error thrown — success
  });

  it('skips messages that no longer exist', async (t) => {
    const original = reminderModel.findDueReminders;
    t.mock.method(reminderModel, 'findDueReminders', async () => [
      { id: 1, message_id: 999, user_id: 1, remind_at: new Date(), is_sent: 0, created_at: new Date() },
    ]);
    t.mock.method(reminderModel, 'markAsSent', async () => {});

    // Should not throw — the missing message is skipped gracefully.
    await reminderService.processDueReminders(new Date());

    // markAsSent should not have been called (no successful reminders).
    assert.equal((reminderModel.markAsSent as any).mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// ReminderController
// ---------------------------------------------------------------------------

describe('ReminderController.getReminder', () => {
  it('returns 400 for an invalid (non-numeric) message id', async () => {
    const req = mockReq({ id: 'abc' });
    const res = mockRes();
    await reminderController.getReminder(req, res);
    assert.equal(res._status, 400);
    assert.equal(res._body.message, 'Invalid message ID');
  });

  it('returns 404 when the message does not exist', async () => {
    const req = mockReq({ id: '999' });
    const res = mockRes();
    await reminderController.getReminder(req, res);
    assert.equal(res._status, 404);
    assert.equal(res._body.message, 'Message not found');
  });

  it('returns 200 with null data when no reminder is set', async () => {
    const req = mockReq({ id: '1' });
    const res = mockRes();
    await reminderController.getReminder(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.success, true);
    assert.equal(res._body.data, null);
  });

  it('returns 200 with reminder data when one exists', async () => {
    const req = mockReq({ id: '200' });
    const res = mockRes();
    await reminderController.getReminder(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.success, true);
    assert.ok(res._body.data);
    assert.equal(res._body.data.id, 10);
  });

  it('returns 200 with null data on unexpected DB errors (graceful degradation)', async (t) => {
    // Simulate a DB error (e.g. missing table) that is NOT "Message not found"
    t.mock.method(messageModel, 'findById', async () => {
      throw new Error('Table kneachat.message_reminders doesn\'t exist');
    });
    const req = mockReq({ id: '1' });
    const res = mockRes();
    await reminderController.getReminder(req, res);
    // Graceful degradation: 200 + null instead of 400
    assert.equal(res._status, 200);
    assert.equal(res._body.success, true);
    assert.equal(res._body.data, null);
  });
});

describe('ReminderController.setReminder', () => {
  it('returns 201 with reminder data on success', async () => {
    const req = mockReq({ id: '1' });
    const res = mockRes();
    await reminderController.setReminder(req, res);
    assert.equal(res._status, 201);
    assert.equal(res._body.success, true);
    assert.ok(res._body.data.reminderId);
  });

  it('returns 400 for an invalid message id', async () => {
    const req = mockReq({ id: '0' });
    const res = mockRes();
    await reminderController.setReminder(req, res);
    assert.equal(res._status, 400);
  });

  it('returns 404 when the message does not exist', async () => {
    const req = mockReq({ id: '999' });
    const res = mockRes();
    await reminderController.setReminder(req, res);
    assert.equal(res._status, 404);
  });
});

describe('ReminderController.cancelReminder', () => {
  it('returns 200 when no reminder exists to cancel', async () => {
    const req = mockReq({ id: '1' });
    const res = mockRes();
    await reminderController.cancelReminder(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.data.removed, false);
  });

  it('returns 200 when a reminder is cancelled', async () => {
    const req = mockReq({ id: '200' });
    const res = mockRes();
    await reminderController.cancelReminder(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.data.removed, true);
  });

  it('returns 404 when the message does not exist', async () => {
    const req = mockReq({ id: '999' });
    const res = mockRes();
    await reminderController.cancelReminder(req, res);
    assert.equal(res._status, 404);
  });
});
