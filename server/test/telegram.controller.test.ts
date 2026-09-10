'use strict';

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { TelegramController } from '../src/integrations/telegram/telegram.controller';
import type { OmniChannelService } from '../src/services/OmniChannel.service';

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

const makeController = (overrides: Record<string, unknown> = {}) => {
  const omni = {
    processInbound: async () => ({ processed: 0, ignored: 0 }),
    ...overrides,
  } as unknown as OmniChannelService;
  return new TelegramController(omni);
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
      processInbound: async () => {
        processed = true;
        return { processed: 1, ignored: 0 };
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
      processInbound: async () => {
        processed = true;
        return { processed: 1, ignored: 0 };
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
      processInbound: async () => {
        processed = true;
        return { processed: 1, ignored: 0 };
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
      processInbound: async () => {
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

describe('TelegramController — setupWebhook', () => {
  const originalUrl = process.env.TELEGRAM_WEBHOOK_URL;

  after(() => {
    if (originalUrl === undefined) {
      delete process.env.TELEGRAM_WEBHOOK_URL;
    } else {
      process.env.TELEGRAM_WEBHOOK_URL = originalUrl;
    }
  });

  it('defaults to the TELEGRAM_WEBHOOK_URL environment variable', async () => {
    process.env.TELEGRAM_WEBHOOK_URL = 'https://example.com/api/telegram/webhook';
    let calledWith = '';
    const controller = makeController({
      setupWebhook: async (_channel: string, url: string) => {
        calledWith = url;
        return { ok: true };
      },
    });
    const res = makeRes();
    const req = { body: {} } as never;

    await controller.setupWebhook(req as never, res as unknown as never);

    assert.equal(calledWith, 'https://example.com/api/telegram/webhook');
    assert.equal(res.statusCode, 200);
    assert.equal((res.body as { success: boolean }).success, true);
  });

  it('prefers a webhookUrl in the request body over the environment', async () => {
    process.env.TELEGRAM_WEBHOOK_URL = 'https://env.example.com/api/telegram/webhook';
    let calledWith = '';
    const controller = makeController({
      setupWebhook: async (_channel: string, url: string) => {
        calledWith = url;
        return { ok: true };
      },
    });
    const res = makeRes();
    const req = {
      body: { webhookUrl: 'https://posted.example.com/api/telegram/webhook' },
    } as never;

    await controller.setupWebhook(req as never, res as unknown as never);

    assert.equal(calledWith, 'https://posted.example.com/api/telegram/webhook');
    assert.equal(res.statusCode, 200);
  });

  it('rejects a non-HTTPS URL with 400', async () => {
    process.env.TELEGRAM_WEBHOOK_URL = '';
    const controller = makeController({
      setupWebhook: async () => ({ ok: true }),
    });
    const res = makeRes();
    const req = { body: { webhookUrl: 'http://insecure.example.com/webhook' } } as never;

    await controller.setupWebhook(req as never, res as unknown as never);

    assert.equal(res.statusCode, 400);
  });

  it('maps a Telegram rejection to 502', async () => {
    process.env.TELEGRAM_WEBHOOK_URL = 'https://example.com/api/telegram/webhook';
    const controller = makeController({
      setupWebhook: async () => ({ ok: false, description: 'wrong url specified' }),
    });
    const res = makeRes();
    const req = { body: {} } as never;

    await controller.setupWebhook(req as never, res as unknown as never);

    assert.equal(res.statusCode, 502);
    assert.match((res.body as { message: string }).message, /wrong url specified/);
  });
});