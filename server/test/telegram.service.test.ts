'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TelegramService, TelegramApiError, telegramMediaMethodFor } from '../src/integrations/telegram/telegram.service';
import type { HttpLike } from '../src/integrations/telegram/telegram.service';

const TOKEN = '123456:TEST-SECRET-TOKEN';

interface CapturedCall {
  method: 'get' | 'post';
  url: string;
  body?: unknown;
}

/** HTTP stub that records calls and returns a configurable Telegram envelope. */
const makeHttp = (handler?: (call: CapturedCall) => Promise<{ data: unknown }>): HttpLike & { calls: CapturedCall[] } => {
  const calls: CapturedCall[] = [];
  const http: HttpLike & { calls: CapturedCall[] } = {
    calls,
    async get<T>(url: string): Promise<{ data: T }> {
      const call: CapturedCall = { method: 'get', url };
      calls.push(call);
      if (handler) return handler(call) as Promise<{ data: T }>;
      return { data: { ok: true, result: { id: 1, is_bot: true, first_name: 'Test', username: 'kneachat_test_bot' } } as T };
    },
    async post<T>(url: string, body?: unknown): Promise<{ data: T }> {
      const call: CapturedCall = { method: 'post', url, body };
      calls.push(call);
      if (handler) return handler(call) as Promise<{ data: T }>;
      return { data: { ok: true, result: { message_id: 99 } } as T };
    },
    async postForm<T>(url: string, form: FormData): Promise<{ data: T }> {
      const call: CapturedCall = { method: 'post' as const, url, body: form };
      calls.push(call);
      if (handler) return handler(call) as Promise<{ data: T }>;
      return { data: { ok: true, result: { message_id: 99 } } as T };
    },
    async getBuffer(url: string): Promise<Buffer> {
      const call: CapturedCall = { method: 'get', url };
      calls.push(call);
      if (handler) {
        const result = await handler(call);
        return (result as { data: Buffer }).data as Buffer;
      }
      return Buffer.from('fake-binary');
    },
  };
  return http;
};

describe('TelegramService', () => {
  it('isConfigured() reflects whether a bot token is present', () => {
    assert.equal(new TelegramService('token').isConfigured(), true);
    assert.equal(new TelegramService('').isConfigured(), false);
    assert.equal(new TelegramService(undefined as unknown as string).isConfigured(), false);
  });

  it('getMe returns the bot identity', async () => {
    const http = makeHttp();
    const service = new TelegramService(TOKEN, 'https://api.telegram.org/bot', http);

    const result = await service.getMe();

    assert.equal(result.ok, true);
    assert.equal(result.result?.username, 'kneachat_test_bot');
    assert.equal(http.calls.length, 1);
    assert.equal(http.calls[0].method, 'get');
    assert.ok(http.calls[0].url.endsWith(`/bot${TOKEN}/getMe`));
  });

  it('sendMessage posts chat_id and text to the sendMessage method', async () => {
    const http = makeHttp();
    const service = new TelegramService(TOKEN, 'https://api.telegram.org/bot', http);

    const result = await service.sendMessage(123456789, 'Hello!');

    assert.equal(result.ok, true);
    assert.equal(http.calls[0].method, 'post');
    assert.ok(http.calls[0].url.endsWith(`/bot${TOKEN}/sendMessage`));
    assert.deepEqual(http.calls[0].body, { chat_id: 123456789, text: 'Hello!' });
  });

  it('sendMessage includes reply_to_message_id when provided', async () => {
    const http = makeHttp();
    const service = new TelegramService(TOKEN, 'https://api.telegram.org/bot', http);

    await service.sendMessage(123456789, 'Replying', { reply_to_message_id: 55 });

    assert.deepEqual(http.calls[0].body, {
      chat_id: 123456789,
      text: 'Replying',
      reply_to_message_id: 55,
    });
  });

  it('setWebhook posts the URL and the configured secret token', async () => {
    const http = makeHttp();
    const service = new TelegramService(TOKEN, 'https://api.telegram.org/bot', http);

    await service.setWebhook('https://example.com/api/telegram/webhook', 'my-secret');

    assert.equal(http.calls[0].method, 'post');
    assert.ok(http.calls[0].url.endsWith(`/bot${TOKEN}/setWebhook`));
    assert.deepEqual(http.calls[0].body, {
      url: 'https://example.com/api/telegram/webhook',
      allowed_updates: ['message'],
      secret_token: 'my-secret',
    });
  });

  it('deleteWebhook and getWebhookInfo hit the right methods', async () => {
    const http = makeHttp();
    const service = new TelegramService(TOKEN, 'https://api.telegram.org/bot', http);

    await service.deleteWebhook();
    await service.getWebhookInfo();

    assert.equal(http.calls[0].method, 'post');
    assert.ok(http.calls[0].url.endsWith('/deleteWebhook'));
    assert.equal(http.calls[1].method, 'get');
    assert.ok(http.calls[1].url.endsWith('/getWebhookInfo'));
  });

  it('propagates Telegram API errors with the safe description + error code', async () => {
    const http = makeHttp(async () => {
      const error = new Error('Request failed') as Error & { response?: unknown };
      error.response = { data: { ok: false, error_code: 401, description: 'Unauthorized' } };
      throw error;
    });
    const service = new TelegramService(TOKEN, 'https://api.telegram.org/bot', http);

    await assert.rejects(service.getMe(), (error: unknown) => {
      assert.ok(error instanceof TelegramApiError);
      assert.match((error as Error).message, /Unauthorized/);
      assert.equal((error as TelegramApiError).errorCode, 401);
      return true;
    });
  });

  it('reports network failures generically and never leaks the token', async () => {
    const http = makeHttp(async () => {
      throw new Error('ECONNREFUSED api.telegram.org');
    });
    const service = new TelegramService(TOKEN, 'https://api.telegram.org/bot', http);

    await assert.rejects(service.getMe(), (error: unknown) => {
      const message = (error as Error).message;
      assert.ok(error instanceof TelegramApiError);
      assert.match(message, /unreachable/);
      assert.ok(!message.includes(TOKEN), 'token must never appear in the error message');
      return true;
    });
  });

  it('getFile resolves a file_id to a file_path', async () => {
    const http = makeHttp();
    const service = new TelegramService(TOKEN, 'https://api.telegram.org/bot', http);

    const result = await service.getFile('abc123');

    assert.equal(result.ok, true);
    assert.ok(http.calls[0].url.includes('/getFile'), 'calls the getFile method');
    assert.ok(http.calls[0].url.includes('file_id=abc123'), 'passes the file_id');
  });

  it('downloadFile fetches binary from the /file/ endpoint', async () => {
    const http = makeHttp();
    const service = new TelegramService(TOKEN, 'https://api.telegram.org/bot', http);

    const buffer = await service.downloadFile('photos/photo.jpg');

    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 0);
    assert.equal(
      http.calls[0].url,
      `https://api.telegram.org/file/bot${TOKEN}/photos/photo.jpg`,
    );
  });

  it('throws a safe error when the bot token is not configured', async () => {
    const http = makeHttp();
    const service = new TelegramService('', 'https://api.telegram.org/bot', http);

    await assert.rejects(service.getMe(), (error: unknown) => {
      assert.ok(error instanceof TelegramApiError);
      assert.match((error as Error).message, /TELEGRAM_BOT_TOKEN/);
      assert.equal(http.calls.length, 0, 'no API call without a token');
      return true;
    });
  });

  it('sendMedia posts multipart to sendPhoto for images', async () => {
    const http = makeHttp();
    const service = new TelegramService(TOKEN, 'https://api.telegram.org/bot', http);

    const result = await service.sendMedia(123456789, {
      kind: 'image',
      buffer: Buffer.from('png-bytes'),
      fileName: 'shot.png',
      mimeType: 'image/png',
      caption: 'Look at this',
    });

    assert.equal(result.ok, true);
    assert.equal(http.calls.length, 1);
    assert.ok(http.calls[0].url.endsWith(`/bot${TOKEN}/sendPhoto`));
    const form = http.calls[0].body as FormData;
    assert.ok(form instanceof FormData);
    assert.equal(form.get('chat_id'), '123456789');
    assert.equal(form.get('caption'), 'Look at this');
    const file = form.get('photo');
    assert.ok(file instanceof File);
    assert.equal((file as File).name, 'shot.png');
  });

  it('sendMedia routes webm voice notes through sendDocument (sendVoice needs ogg)', async () => {
    const http = makeHttp();
    const service = new TelegramService(TOKEN, 'https://api.telegram.org/bot', http);

    await service.sendMedia(123456789, {
      kind: 'voice',
      buffer: Buffer.from('webm-bytes'),
      fileName: 'voice-1.webm',
      mimeType: 'audio/webm;codecs=opus',
    });

    assert.ok(http.calls[0].url.endsWith('/sendDocument'));
    const form = http.calls[0].body as FormData;
    assert.ok(form.has('document'));
    assert.equal(form.get('caption'), null, 'no caption field when none given');
  });

  it('sendMedia uses sendVoice for ogg voice notes', async () => {
    const http = makeHttp();
    const service = new TelegramService(TOKEN, 'https://api.telegram.org/bot', http);

    await service.sendMedia(123456789, {
      kind: 'voice',
      buffer: Buffer.from('ogg-bytes'),
      fileName: 'voice_2.ogg',
      mimeType: 'audio/ogg',
    });

    assert.ok(http.calls[0].url.endsWith('/sendVoice'));
    assert.ok((http.calls[0].body as FormData).has('voice'));
  });

  it('sendMedia throws a safe error when the token is missing', async () => {
    const http = makeHttp();
    const service = new TelegramService('', 'https://api.telegram.org/bot', http);

    await assert.rejects(
      service.sendMedia(1, { kind: 'file', buffer: Buffer.from('x'), fileName: 'a.pdf', mimeType: 'application/pdf' }),
      /TELEGRAM_BOT_TOKEN/,
    );
    assert.equal(http.calls.length, 0);
  });

  it('telegramMediaMethodFor maps kinds + extensions onto Bot API methods', () => {
    assert.deepEqual(telegramMediaMethodFor('image', 'p.jpg', 'image/jpeg'), { method: 'sendPhoto', field: 'photo' });
    // GIFs must travel as documents — sendPhoto rejects them.
    assert.deepEqual(telegramMediaMethodFor('image', 'anim.gif', 'image/gif'), { method: 'sendDocument', field: 'document' });
    assert.deepEqual(telegramMediaMethodFor('voice', 'v.ogg', 'audio/ogg'), { method: 'sendVoice', field: 'voice' });
    assert.deepEqual(telegramMediaMethodFor('voice', 'v.m4a', 'audio/mp4'), { method: 'sendDocument', field: 'document' });
    assert.deepEqual(telegramMediaMethodFor('file', 'r.pdf', 'application/pdf'), { method: 'sendDocument', field: 'document' });
  });
});