'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TelegramChannelAdapter } from '../src/integrations/telegram/telegram.adapter';
import type { TelegramService } from '../src/integrations/telegram/telegram.service';
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

const makeApi = (overrides: Record<string, unknown> = {}) =>
  ({
    isConfigured: () => true,
    getMe: async () => ({ ok: true, result: { id: 1, is_bot: true, first_name: 'B', username: 'test_bot' } }),
    sendMessage: async () => ({ ok: true, result: { message_id: 42 } }),
    getFile: async (fileId: string) => ({ ok: true, result: { file_id: fileId, file_path: 'photos/photo.jpg' } }),
    downloadFile: async () => Buffer.from('fake-bytes'),
    setWebhook: async () => ({ ok: true, result: true }),
    getWebhookInfo: async () => ({ ok: true, result: { url: '', has_custom_certificate: false, pending_update_count: 0 } }),
    deleteWebhook: async () => ({ ok: true, result: true }),
    ...overrides,
  }) as unknown as TelegramService;

describe('TelegramChannelAdapter — parseInbound', () => {
  const adapter = new TelegramChannelAdapter(makeApi());

  it('parses a private text message into a normalized inbound message', async () => {
    const messages = await adapter.parseInbound(makeUpdate());

    assert.equal(messages.length, 1);
    assert.equal(messages[0].externalContactId, '123456789');
    assert.equal(messages[0].username, 'john123');
    assert.equal(messages[0].firstName, 'John');
    assert.equal(messages[0].lastName, 'Smith');
    assert.equal(messages[0].externalMessageId, '111');
    assert.equal(messages[0].content, 'Hello, I need help.');
    assert.equal(messages[0].media, null);
    assert.ok(messages[0].externalTimestamp);
  });

  it('ignores unsupported update kinds (edited_message, channel_post, …)', async () => {
    assert.deepEqual(await adapter.parseInbound({ update_id: 2, edited_message: { message_id: 1 } }), []);
    assert.deepEqual(await adapter.parseInbound({ update_id: 3 }), []);
  });

  it('ignores updates missing the sender or the chat', async () => {
    const noFrom = makeUpdate();
    delete (noFrom.message as unknown as Record<string, unknown>).from;
    assert.deepEqual(await adapter.parseInbound(noFrom), []);

    const noChat = makeUpdate();
    delete (noChat.message as unknown as Record<string, unknown>).chat;
    assert.deepEqual(await adapter.parseInbound(noChat), []);
  });

  it('ignores non-text, non-media messages (polls, locations, …)', async () => {
    const update = makeUpdate();
    delete (update.message as unknown as Record<string, unknown>).text;
    assert.deepEqual(await adapter.parseInbound(update), []);
  });

  it('normalizes a photo with its caption as content and a media reference', async () => {
    const update = makeUpdate();
    update.message = {
      ...update.message!,
      text: undefined,
      caption: 'Look at this',
      photo: [
        { file_id: 'small', file_unique_id: 's', width: 100, height: 50 },
        { file_id: 'large', file_unique_id: 'l', width: 800, height: 600 },
      ],
    };

    const [message] = await adapter.parseInbound(update);

    assert.equal(message.content, 'Look at this');
    assert.equal(message.media?.kind, 'image');
    assert.equal(message.media?.fileRef, 'large', 'largest photo wins');
    assert.equal(message.media?.fileName, 'photo_111.jpg');
    assert.equal(message.media?.mimeType, 'image/jpeg');
  });

  it('normalizes a voice note', async () => {
    const update = makeUpdate();
    update.message = {
      ...update.message!,
      text: undefined,
      voice: { file_id: 'voice1', file_unique_id: 'v', duration: 4, mime_type: 'audio/ogg' },
    };

    const [message] = await adapter.parseInbound(update);

    assert.equal(message.content, 'voice_111.ogg');
    assert.equal(message.media?.kind, 'voice');
    assert.equal(message.media?.fileRef, 'voice1');
  });

  it('uses the file name for a document without a caption', async () => {
    const update = makeUpdate();
    update.message = {
      ...update.message!,
      text: undefined,
      document: {
        file_id: 'doc1',
        file_unique_id: 'd',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
      },
    };

    const [message] = await adapter.parseInbound(update);

    assert.equal(message.content, 'report.pdf');
    assert.equal(message.media?.kind, 'file');
    assert.equal(message.media?.mimeType, 'application/pdf');
  });
});

describe('TelegramChannelAdapter — media download', () => {
  it('downloads the file through the file server', async () => {
    const adapter = new TelegramChannelAdapter(makeApi());
    const buffer = await adapter.downloadMedia({
      kind: 'image',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileRef: 'abc',
    });

    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.toString(), 'fake-bytes');
  });

  it('returns null when getFile fails', async () => {
    const adapter = new TelegramChannelAdapter(
      makeApi({ getFile: async () => ({ ok: false, description: 'file too big' }) }),
    );
    const buffer = await adapter.downloadMedia({
      kind: 'image',
      fileName: 'p.jpg',
      mimeType: 'image/jpeg',
      fileRef: 'abc',
    });
    assert.equal(buffer, null);
  });

  it('returns null when the API call throws', async () => {
    const adapter = new TelegramChannelAdapter(
      makeApi({
        getFile: async () => {
          throw new Error('network down');
        },
      }),
    );
    const buffer = await adapter.downloadMedia({
      kind: 'image',
      fileName: 'p.jpg',
      mimeType: 'image/jpeg',
      fileRef: 'abc',
    });
    assert.equal(buffer, null);
  });
});

describe('TelegramChannelAdapter — sendMessage', () => {
  it('maps a successful send to an OmniOutboundResult with the message id', async () => {
    const adapter = new TelegramChannelAdapter(makeApi());
    const result = await adapter.sendMessage(123456789, 'Hello!');
    assert.deepEqual(result, { ok: true, externalMessageId: '42' });
  });

  it('maps replyToExternalMessageId to reply_to_message_id', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const api = makeApi({
      sendMessage: async (_chatId: number, _text: string, options?: unknown) => {
        sent.push({ options });
        return { ok: true, result: { message_id: 43 } };
      },
    });
    const adapter = new TelegramChannelAdapter(api);

    await adapter.sendMessage(123456789, 'Replying', { replyToExternalMessageId: '111' });

    assert.deepEqual(sent[0].options, { reply_to_message_id: 111 });
  });

  it('reports ok:false with the safe description when Telegram rejects', async () => {
    const adapter = new TelegramChannelAdapter(
      makeApi({
        sendMessage: async () => ({
          ok: false,
          description: 'bot was blocked by the user',
          error_code: 403,
        }),
      }),
    );
    const result = await adapter.sendMessage(123456789, 'Hello');
    assert.deepEqual(result, {
      ok: false,
      description: 'bot was blocked by the user',
      errorCode: 403,
    });
  });

  it('reports ok:false when the API throws (never leaks the token)', async () => {
    const adapter = new TelegramChannelAdapter(
      makeApi({
        sendMessage: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
    );
    const result = await adapter.sendMessage(123456789, 'Hello');
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes('TOKEN'));
  });
});

describe('TelegramChannelAdapter — health + webhook administration', () => {
  it('reports connected when the bot authenticates', async () => {
    const adapter = new TelegramChannelAdapter(makeApi());
    const health = await adapter.getHealth();
    assert.equal(health.connected, true);
    assert.equal((health.info?.bot as { username: string }).username, 'test_bot');
  });

  it('reports not configured without a token', async () => {
    const adapter = new TelegramChannelAdapter(makeApi({ isConfigured: () => false }));
    const health = await adapter.getHealth();
    assert.equal(health.connected, false);
  });

  it('delegates webhook administration to the API client', async () => {
    const api = makeApi();
    const adapter = new TelegramChannelAdapter(api);

    await adapter.setupWebhook('https://example.com/api/telegram/webhook');
    await adapter.getWebhookInfo();
    await adapter.deleteWebhook();
  });
});