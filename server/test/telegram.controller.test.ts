'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { TelegramController } from '../src/integrations/telegram/telegram.controller';
import type { TelegramService } from '../src/integrations/telegram/telegram.service';
import type { TelegramInboxService } from '../src/services/TelegramInbox.service';

interface FakeRes {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
  sendStatus(code: number): FakeRes;
}

const makeRes = (): FakeRes => {
  const res: FakeRes = {
    statusCode: 0,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    sendStatus(code: number) {
      res.statusCode = code;
      return res;
    },
  };
  return res;
};

const makeController = (overrides: Partial<Record<'handleWebhookUpdate', unknown>> = {}) => {
  const inbox = {
    handleWebhookUpdate: async () => null,
    ...overrides,
  } as unknown as TelegramInboxService;
  const telegramApi = { isConfigured: () => true } as unknown as TelegramService;
  return new TelegramController(inbox, telegramApi);
};

describe('TelegramController — webhook', () => {
  const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'super-secret-webhook-token';
  });

  it('rejects a request with a missing secret header (401)', async () => {
    const controller = makeController();
    const res = makeRes();
    const req = { headers: {}, body: { update_id: 1 } } as never;

    await controller.webhook(req as never, res as unknown as never);

    assert.equal(res.statusCode, 401);
    assert.equal((res.body as { message: string }).message, 'Invalid webhook secret token');
  });

  it('rejects a request with the wrong secret (401) without processing', async () => {
    let processed = false;
    const controller = makeController({
      handleWebhookUpdate: async () => {
        processed = true;
        return null;
      },
    });
    const res = makeRes();
    const req = {
      headers: { 'x-telegram-bot-api-secret-token': 'wrong-token' },
      body: { update_id: 1 },
    } as never;

    await controller.webhook(req as never, res as unknown as never);

    assert.equal(res.statusCode, 401);
    assert.equal(processed, false);
  });

  it('accepts a request with the correct secret and acknowledges with 200', async () => {
    let processed = false;
    const controller = makeController({
      handleWebhookUpdate: async () => {
        processed = true;
        return null;
      },
    });
    const res = makeRes();
    const req = {
      headers: { 'x-telegram-bot-api-secret-token': 'super-secret-webhook-token' },
      body: { update_id: 1, message: { message_id: 1, date: 1, chat: { id: 1, type: 'private' } } },
    } as never;

    await controller.webhook(req as never, res as unknown as never);

    assert.equal(res.statusCode, 200);
    assert.equal(processed, true);
  });

  it('acknowledges malformed updates with 200 without processing', async () => {
    let processed = false;
    const controller = makeController({
      handleWebhookUpdate: async () => {
        processed = true;
        return null;
      },
    });
    const res = makeRes();
    const req = {
      headers: { 'x-telegram-bot-api-secret-token': 'super-secret-webhook-token' },
      body: { foo: 'bar' },
    } as never;

    await controller.webhook(req as never, res as unknown as never);

    assert.equal(res.statusCode, 200);
    assert.equal(processed, false);
  });

  it('never crashes the server when processing throws (logs + 500)', async () => {
    const controller = makeController({
      handleWebhookUpdate: async () => {
        throw new Error('db down');
      },
    });
    const res = makeRes();
    const req = {
      headers: { 'x-telegram-bot-api-secret-token': 'super-secret-webhook-token' },
      body: { update_id: 1 },
    } as never;

    await controller.webhook(req as never, res as unknown as never);

    assert.equal(res.statusCode, 500);
  });

  it('restores the original secret after the suite', () => {
    if (originalSecret === undefined) {
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
    } else {
      process.env.TELEGRAM_WEBHOOK_SECRET = originalSecret;
    }
  });
});