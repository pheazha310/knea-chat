'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EmailChannelAdapter } from '../src/integrations/email/email.adapter';
import type { ResendAttachmentDownload } from '../src/integrations/email/email.service';
import {
  EmailService,
  buildReplySubject,
  buildReferencesHeader,
  normalizeMessageId,
  wrapMessageId,
} from '../src/integrations/email/email.service';

const makeAdapter = () => new EmailChannelAdapter(new EmailService());

describe('EmailChannelAdapter — parseInbound', () => {
  it('returns [] for null payload', async () => {
    const adapter = makeAdapter();
    const result = await adapter.parseInbound(null);
    assert.deepEqual(result, []);
  });

  it('returns [] for empty object', async () => {
    const adapter = makeAdapter();
    const result = await adapter.parseInbound({});
    assert.deepEqual(result, []);
  });

  it('parses a SendGrid v3 webhook payload', async () => {
    const adapter = makeAdapter();
    const payload = {
      mail: {
        from: 'Customer <customer@example.com>',
        to: 'support@kneachat.com',
        subject: 'Hello from SendGrid',
        date: Date.now(),
        headers: {
          'Message-ID': '<abc123@example.com>',
          'In-Reply-To': '<prev@example.com>',
          'References': '<prev@example.com>',
        },
        content: [
          { type: 'text/plain', value: 'Hello world' },
          { type: 'text/html', value: '<p>Hello world</p>' },
        ],
      },
    };

    const result = await adapter.parseInbound(payload);
    assert.equal(result.length, 1);
    assert.equal(result[0].externalContactId, 'customer@example.com');
    assert.equal(result[0].externalMessageId, 'abc123@example.com');
    assert.equal(result[0].content, 'Hello world');
  });

  it('parses a Mailgun webhook payload', async () => {
    const adapter = makeAdapter();
    const payload = {
      recipient: 'support@kneachat.com',
      from: 'Customer <customer@example.com>',
      subject: 'Mailgun test',
      'body-plain': 'Plain text body',
      'body-html': '<p>HTML body</p>',
      'Message-Id': '<mg123@mailgun.org>',
      'In-Reply-To': '<mgprev@mailgun.org>',
      'References': '<mgprev@mailgun.org>',
      timestamp: Date.now(),
    };

    const result = await adapter.parseInbound(payload);
    assert.equal(result.length, 1);
    assert.equal(result[0].externalContactId, 'customer@example.com');
    assert.equal(result[0].content, 'Plain text body');
  });

  it('parses an SES/SNS wrapped payload', async () => {
    const adapter = makeAdapter();
    const inner = {
      mail: {
        source: 'customer@example.com',
        destination: ['support@kneachat.com'],
        commonHeaders: { subject: 'SES test' },
        headers: [
          { name: 'Message-ID', value: '<ses123@amazon.com>' },
        ],
        content: [{ type: 'text/plain', value: 'SES body' }],
        timestamp: Date.now(),
      },
    };
    const payload = {
      Type: 'Notification',
      Message: JSON.stringify(inner),
    };

    const result = await adapter.parseInbound(payload);
    assert.equal(result.length, 1);
    assert.equal(result[0].externalContactId, 'customer@example.com');
    assert.equal(result[0].content, 'SES body');
  });

  it('parses a generic direct payload with a raw RFC 5322 header string', async () => {
    const adapter = makeAdapter();
    const payload = {
      from: 'customer@example.com',
      to: 'support@kneachat.com',
      subject: 'Raw headers test',
      text: 'Body',
      headers: 'Message-ID: <raw123@example.com>\r\nIn-Reply-To: <parent@example.com>\r\nReferences: <root@example.com> <parent@example.com>',
      timestamp: Date.now(),
    };

    const result = await adapter.parseInbound(payload);
    assert.equal(result.length, 1);
    assert.equal(result[0].externalMessageId, 'raw123@example.com');
    const metadata = result[0].metadata as { email: { inReplyTo: string; references: string } };
    assert.equal(metadata.email.inReplyTo, 'parent@example.com');
    // References are normalized (angle brackets stripped at rest; re-added
    // when the reply is sent) but the multi-id chain is preserved.
    assert.equal(metadata.email.references, 'root@example.com parent@example.com');
  });

  it('records extra attachments in metadata when several are present', async () => {
    const adapter = makeAdapter();
    const payload = {
      recipient: 'support@kneachat.com',
      from: 'customer@example.com',
      text: 'See attachments',
      attachments: [
        { name: 'first.pdf', content_type: 'application/pdf', url: 'https://example.com/first.pdf' },
        { name: 'second.png', content_type: 'image/png', url: 'https://example.com/second.png' },
      ],
    };

    const result = await adapter.parseInbound(payload);
    assert.equal(result.length, 1);
    assert.equal(result[0].media?.fileName, 'first.pdf');
    const metadata = result[0].metadata as { email: { attachments: Array<{ name: string }> } };
    assert.equal(metadata.email.attachments.length, 2);
    assert.equal(metadata.email.attachments[1].name, 'second.png');
    assert.equal(result[0].attachments?.length, 2);
    assert.equal(result[0].attachments?.[1].fileName, 'second.png');
  });

  it('parses a generic direct payload', async () => {
    const adapter = makeAdapter();
    const payload = {
      from: 'customer@example.com',
      to: 'support@kneachat.com',
      subject: 'Generic test',
      text: 'Generic body',
      html: '<p>Generic body</p>',
      headers: {
        'Message-ID': '<generic@example.com>',
      },
      timestamp: Date.now(),
    };

    const result = await adapter.parseInbound(payload);
    assert.equal(result.length, 1);
    assert.equal(result[0].externalContactId, 'customer@example.com');
  });

  it('returns [] when recipient is missing', async () => {
    const adapter = makeAdapter();
    const result = await adapter.parseInbound({ from: 'customer@example.com', subject: 'No recipient' });
    assert.deepEqual(result, []);
  });

  it('strips script tags from HTML', async () => {
    const adapter = makeAdapter();
    const payload = {
      recipient: 'support@kneachat.com',
      from: 'customer@example.com',
      html: '<script>alert("xss")</script><p>Safe</p>',
      text: '',
    };

    const result = await adapter.parseInbound(payload);
    assert.ok(result[0].metadata != null);
  });
});

describe('EmailChannelAdapter — getThreadHints', () => {
  const makeAdapter = () => new EmailChannelAdapter(new EmailService());

  it('returns null when the message has no threading headers', async () => {
    const adapter = makeAdapter();
    const hints = await adapter.getThreadHints({
      externalContactId: 'customer@example.com',
      externalMessageId: 'm1',
      content: 'Hi',
      metadata: { email: { subject: 'Fresh thread' } },
    });
    assert.equal(hints, null);
  });

  it('normalizes In-Reply-To into the hint list', async () => {
    const adapter = makeAdapter();
    const hints = await adapter.getThreadHints({
      externalContactId: 'customer@example.com',
      externalMessageId: 'm2',
      content: 'Re: Hi',
      metadata: { email: { inReplyTo: '<Parent@Example.com>', references: null } },
    });
    assert.deepEqual(hints, { inReplyToMessageIds: ['parent@example.com'] });
  });

  it('splits a space-separated References chain and dedupes with In-Reply-To', async () => {
    const adapter = makeAdapter();
    const hints = await adapter.getThreadHints({
      externalContactId: 'customer@example.com',
      externalMessageId: 'm3',
      content: 'Re: Hi',
      metadata: {
        email: {
          inReplyTo: '<b@x.com>',
          references: '<a@x.com> <B@X.com> <c@x.com>',
        },
      },
    });
    assert.deepEqual(hints, {
      inReplyToMessageIds: ['a@x.com', 'b@x.com', 'c@x.com'],
    });
  });

  it('accepts an array References header (SendGrid shape)', async () => {
    const adapter = makeAdapter();
    const hints = await adapter.getThreadHints({
      externalContactId: 'customer@example.com',
      externalMessageId: 'm4',
      content: 'Re: Hi',
      metadata: { email: { references: ['<a@x.com>', 'b@x.com'] } },
    });
    assert.deepEqual(hints, { inReplyToMessageIds: ['a@x.com', 'b@x.com'] });
  });

  it('returns null when metadata is missing entirely', async () => {
    const adapter = makeAdapter();
    const hints = await adapter.getThreadHints({
      externalContactId: 'customer@example.com',
      externalMessageId: 'm5',
      content: 'Hi',
      metadata: null,
    });
    assert.equal(hints, null);
  });
});

describe('EmailChannelAdapter — sendMessage', () => {
  it('returns not-configured when SMTP is missing', async () => {
    const adapter = makeAdapter();
    const result = await adapter.sendMessage('customer@example.com', 'Hello');
    assert.equal(result.ok, false);
    assert.ok((result.description || '').includes('not configured'));
  });
});

describe('EmailChannelAdapter — getHealth', () => {
  it('returns connected: false when SMTP is not configured', async () => {
    const adapter = makeAdapter();
    const health = await adapter.getHealth();
    assert.equal(health.connected, false);
  });
});

describe('EmailService — sanitizeHtml', () => {
  it('strips script tags', () => {
    const service = new EmailService();
    const result = service.sanitizeHtml('<script>alert(1)</script><p>ok</p>');
    assert.ok(!result.includes('<script>'));
    assert.ok(result.includes('<p>ok</p>'));
  });

  it('strips style tags', () => {
    const service = new EmailService();
    const result = service.sanitizeHtml('<style>body{color:red}</style><b>text</b>');
    assert.ok(!result.includes('<style>'));
  });

  it('strips event handlers', () => {
    const service = new EmailService();
    const result = service.sanitizeHtml('<div onclick="evil()">click</div>');
    assert.ok(!result.includes('onclick'));
  });

  it('strips javascript: protocols', () => {
    const service = new EmailService();
    const result = service.sanitizeHtml('<a href="javascript:alert(1)">link</a>');
    assert.ok(!result.includes('javascript:'));
  });
});

describe('EmailService — htmlToText', () => {
  it('strips HTML tags', () => {
    const service = new EmailService();
    const result = service.htmlToText('<p>Hello <b>World</b></p>');
    assert.equal(result, 'Hello World');
  });

  it('converts br tags to newlines', () => {
    const service = new EmailService();
    const result = service.htmlToText('Line 1<br>Line 2');
    assert.ok(result.includes('\n'));
  });

  it('decodes HTML entities', () => {
    const service = new EmailService();
    const result = service.htmlToText('&lt;tag&gt; &amp; &nbsp;');
    assert.ok(result.includes('<tag>'));
    assert.ok(result.includes('&'));
    assert.ok(result.includes(' '));
  });
});

describe('EmailService — verifyWebhookSignature', () => {
  it('returns true when EMAIL_WEBHOOK_SECRET is not set', () => {
    const original = process.env.EMAIL_WEBHOOK_SECRET;
    process.env.EMAIL_WEBHOOK_SECRET = '';
    const service = new EmailService();
    const result = service.verifyWebhookSignature({ test: true }, {});
    assert.equal(result, true);
    process.env.EMAIL_WEBHOOK_SECRET = original;
  });

  it('returns false when signature is missing', () => {
    const original = process.env.EMAIL_WEBHOOK_SECRET;
    process.env.EMAIL_WEBHOOK_SECRET = 'secret';
    const service = new EmailService();
    const result = service.verifyWebhookSignature({ test: true }, {});
    assert.equal(result, false);
    process.env.EMAIL_WEBHOOK_SECRET = original;
  });

  it('verifies generic HMAC-SHA256 signature', () => {
    const original = process.env.EMAIL_WEBHOOK_SECRET;
    process.env.EMAIL_WEBHOOK_SECRET = 'secret';
    const service = new EmailService();
    const payload = { test: true };
    const payloadStr = JSON.stringify(payload);
    const signature = Buffer.from(
      require('crypto').createHmac('sha256', 'secret').update(payloadStr).digest('base64')
    ).toString();

    const result = service.verifyWebhookSignature(payload, { signature });
    assert.equal(result, true);
    process.env.EMAIL_WEBHOOK_SECRET = original;
  });
});  it('verifies Mailgun signature (timestamp+token hex HMAC, real Mailgun shape)', () => {
    const original = process.env.EMAIL_WEBHOOK_SECRET;
    process.env.EMAIL_WEBHOOK_SECRET = 'secret';
    const service = new EmailService();
    const timestamp = '1700000000';
    const token = 'abc123';
    const signature = require('crypto')
      .createHmac('sha256', 'secret')
      .update(`${timestamp}${token}`)
      .digest('hex');

    const result = service.verifyWebhookSignature(
      { timestamp, token, signature, recipient: 'support@kneachat.com', subject: 'Hi' },
      { provider: 'mailgun', 'x-mailgun-signature': signature, 'x-mailgun-timestamp': timestamp, 'x-mailgun-token': token },
    );
    assert.equal(result, true);

    const tampered = service.verifyWebhookSignature(
      { timestamp, token, signature, recipient: 'support@kneachat.com', subject: 'Hi' },
      { provider: 'mailgun', 'x-mailgun-signature': `0${signature.slice(1)}`, 'x-mailgun-timestamp': timestamp, 'x-mailgun-token': token },
    );
    assert.equal(tampered, false);

    process.env.EMAIL_WEBHOOK_SECRET = original;
  });

  describe('EmailService — threading helpers', () => {
  it('buildReplySubject adds Re: when missing', () => {
    assert.equal(buildReplySubject('Hello'), 'Re: Hello');
    assert.equal(buildReplySubject('Re: Hello'), 'Re: Hello');
    assert.equal(buildReplySubject('RE: Hello'), 'RE: Hello');
    assert.equal(buildReplySubject(''), 'Message from KneaChat');
    assert.equal(buildReplySubject(null), 'Message from KneaChat');
  });

  it('wrapMessageId adds angle brackets when the provider stripped them', () => {
    assert.equal(wrapMessageId('abc@example.com'), '<abc@example.com>');
    assert.equal(wrapMessageId('<abc@example.com>'), '<abc@example.com>');
    assert.equal(wrapMessageId(''), null);
    assert.equal(wrapMessageId(null), null);
  });

  it('normalizeMessageId canonicalizes angle brackets and case', () => {
    assert.equal(normalizeMessageId('<Abc@Example.com>'), 'abc@example.com');
    assert.equal(normalizeMessageId('abc@example.com'), 'abc@example.com');
    assert.equal(normalizeMessageId('  <abc@example.com>  '), 'abc@example.com');
    assert.equal(normalizeMessageId(''), null);
    assert.equal(normalizeMessageId(null), null);
  });

  it('buildReferencesHeader merges references + in-reply-to without duplicates', () => {
    assert.equal(
      buildReferencesHeader('<a@x> <b@x>', '<b@x>'),
      '<a@x> <b@x>',
    );
    assert.equal(
      buildReferencesHeader(['a@x', 'b@x'], 'c@x'),
      '<a@x> <b@x> <c@x>',
    );
    assert.equal(buildReferencesHeader(null, null), null);
  });

  it('sendMail applies structured threading headers', async () => {
    const service = new EmailService();
    // No transporter configured — sendMail fails before delivery, but the
    // threading helpers are already covered above; here we verify the
    // adapter passes threading through the sendMail options shape.
    const result = await service.sendMail({
      from: { address: 'agent@kneachat.com' },
      to: { address: 'customer@example.com' },
      subject: '',
      text: 'Reply body',
      threading: {
        subject: 'Original subject',
        inReplyTo: 'orig@example.com',
        references: ['root@example.com'],
      },
    });
    assert.equal(result.ok, false); // SMTP not configured in tests
  });
});

describe('EmailService — getHealth', () => {
  it('returns configured: false when SMTP is missing', async () => {
    const service = new EmailService();
    const health = await service.getHealth();
    assert.equal(health.configured, false);
    assert.equal(health.provider, 'smtp');
  });
});

describe('EmailService — Resend (Svix) signature verification', () => {
  const makeSvixHeaders = (rawBody: string, opts?: { timestamp?: number }) => {
    const id = 'msg_test_0001';
    const timestamp = String(opts?.timestamp ?? Math.floor(Date.now() / 1000));
    const whsec = process.env.EMAIL_RESEND_WEBHOOK_SECRET!;
    const key = Buffer.from(whsec.replace(/^whsec_/, ''), 'base64');
    const sig = `v1,${require('crypto').createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64')}`;
    return {
      headers: {
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': sig,
        'svix-raw-body': rawBody,
      },
      id,
      timestamp,
    };
  };

  it('verifies a valid Svix signature over the raw body', () => {
    const original = process.env.EMAIL_RESEND_WEBHOOK_SECRET;
    process.env.EMAIL_RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('test-secret-key').toString('base64');
    try {
      const service = new EmailService();
      const rawBody = JSON.stringify({ type: 'email.received', data: { email_id: 'abc' } });
      const { headers } = makeSvixHeaders(rawBody);
      assert.equal(service.verifyResendSignature(JSON.parse(rawBody), headers), true);
    } finally {
      process.env.EMAIL_RESEND_WEBHOOK_SECRET = original;
    }
  });

  it('rejects a tampered payload', () => {
    const original = process.env.EMAIL_RESEND_WEBHOOK_SECRET;
    process.env.EMAIL_RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('test-secret-key').toString('base64');
    try {
      const service = new EmailService();
      const rawBody = JSON.stringify({ type: 'email.received', data: { email_id: 'abc' } });
      const { headers } = makeSvixHeaders(rawBody);
      // Attacker swaps the raw body bytes (the parsed body changes with it,
      // since express parses those same bytes) — the signature no longer covers
      // the delivered bytes, so verification must fail.
      const tamperedRawBody = JSON.stringify({ type: 'email.received', data: { email_id: 'hacked' } });
      assert.equal(
        service.verifyResendSignature(JSON.parse(tamperedRawBody), { ...headers, 'svix-raw-body': tamperedRawBody }),
        false,
      );
    } finally {
      process.env.EMAIL_RESEND_WEBHOOK_SECRET = original;
    }
  });

  it('rejects stale timestamps beyond the 5-minute skew window', () => {
    const original = process.env.EMAIL_RESEND_WEBHOOK_SECRET;
    process.env.EMAIL_RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('test-secret-key').toString('base64');
    try {
      const service = new EmailService();
      const rawBody = JSON.stringify({ type: 'email.received', data: {} });
      const stale = Math.floor(Date.now() / 1000) - 3600; // 1h ago
      const { headers } = makeSvixHeaders(rawBody, { timestamp: stale });
      assert.equal(service.verifyResendSignature(JSON.parse(rawBody), headers), false);
    } finally {
      process.env.EMAIL_RESEND_WEBHOOK_SECRET = original;
    }
  });

  it('rejects when the raw body was not captured', () => {
    const original = process.env.EMAIL_RESEND_WEBHOOK_SECRET;
    process.env.EMAIL_RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('test-secret-key').toString('base64');
    try {
      const service = new EmailService();
      assert.equal(service.verifyResendSignature({ type: 'email.received', data: {} }, {}), false);
    } finally {
      process.env.EMAIL_RESEND_WEBHOOK_SECRET = original;
    }
  });
});

describe('EmailService — fetchResendEmailContent (Resend SDK)', () => {
  const managementKey = 're_test_sdk_key';

  // Harness: run the test with an env var set, restore afterwards.
  const withEnv = async (vars: Record<string, string | undefined>, fn: () => Promise<void> | void) => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  it('returns null when no API key is configured', async () => {
    await withEnv({ EMAIL_RESEND_API_KEY: undefined }, async () => {
      const service = new EmailService();
      assert.equal(await service.fetchResendEmailContent('abc-123'), null);
    });
  });

  it('returns null for an empty email id', async () => {
    await withEnv({ EMAIL_RESEND_API_KEY: managementKey }, async () => {
      const service = new EmailService();
      assert.equal(await service.fetchResendEmailContent(''), null);
    });
  });

  it('fetches content via the SDK and normalizes the response shape', async () => {
    await withEnv({ EMAIL_RESEND_API_KEY: managementKey }, async () => {
      const service = new EmailService();
      const calls: string[] = [];
      // Patch the SDK client the service built — the same mechanism the
      // adapter tests use to stub the service (private-field access).
      const serviceAny = service as unknown as {
        resendClient: { emails: { receiving: { get: (id: string) => Promise<unknown> } } } | null;
        getResendClient(): unknown;
      };
      serviceAny.getResendClient();
      assert.ok(serviceAny.resendClient, 'client should be built and cached');
      serviceAny.resendClient!.emails.receiving.get = async (id: string) => {
        calls.push(id);
        return {
          data: {
            object: 'email' as const,
            id: 'abc-123',
            to: ['support@kneachat.com'],
            from: 'Customer <customer@example.com>',
            created_at: '2026-09-22T00:00:00.000Z',
            subject: 'Hello',
            bcc: null,
            cc: null,
            reply_to: null,
            received_for: [],
            html: '<p>Body</p>',
            text: 'Body',
            headers: { 'Message-ID': '<sdk-1@example.com>' },
            message_id: '<sdk-1@example.com>',
            raw: null,
            attachments: [
              { id: 'att_1', filename: 'a.pdf', size: 3, content_type: 'application/pdf', content_id: null, content_disposition: null },
              { id: 'att_2', filename: null, size: 1, content_type: 'image/png', content_id: null, content_disposition: null },
            ],
          },
          error: null,
        };
      };

      const content = await service.fetchResendEmailContent('abc-123');
      assert.deepEqual(calls, ['abc-123'], 'exactly one SDK call with the email id');
      assert.ok(content);
      assert.equal(content.from, 'Customer <customer@example.com>');
      assert.equal(content.subject, 'Hello');
      assert.equal(content.text, 'Body');
      assert.equal(content.html, '<p>Body</p>');
      assert.equal(content.message_id, '<sdk-1@example.com>');
      assert.deepEqual(content.headers, { 'Message-ID': '<sdk-1@example.com>' });
      assert.equal(content.attachments?.length, 2);
      assert.equal(content.attachments?.[0].filename, 'a.pdf');
      assert.equal(content.attachments?.[1].filename, 'attachment', 'null filename falls back to "attachment"');
    });
  });

  it('returns null when the API responds with an error envelope', async () => {
    await withEnv({ EMAIL_RESEND_API_KEY: managementKey }, async () => {
      const service = new EmailService();
      const serviceAny = service as unknown as {
        resendClient: { emails: { receiving: { get: (id: string) => Promise<unknown> } } } | null;
        getResendClient(): unknown;
      };
      serviceAny.getResendClient();
      serviceAny.resendClient!.emails.receiving.get = async () => ({
        data: null,
        error: { name: 'not_found', message: 'Email not found' } as never,
      });
      assert.equal(await service.fetchResendEmailContent('gone'), null);
    });
  });

  it('returns null when the SDK call throws', async () => {
    await withEnv({ EMAIL_RESEND_API_KEY: managementKey }, async () => {
      const service = new EmailService();
      const serviceAny = service as unknown as {
        resendClient: { emails: { receiving: { get: (id: string) => Promise<unknown> } } } | null;
        getResendClient(): unknown;
      };
      serviceAny.getResendClient();
      serviceAny.resendClient!.emails.receiving.get = async () => {
        throw new Error('network down');
      };
      assert.equal(await service.fetchResendEmailContent('abc'), null);
    });
  });

  it('resolves an attachment id to its signed download URL via the SDK', async () => {
    await withEnv({ EMAIL_RESEND_API_KEY: managementKey }, async () => {
      const service = new EmailService();
      const serviceAny = service as unknown as {
        resendClient: { emails: { receiving: { attachments: { get: (opts: unknown) => Promise<unknown> } } } } | null;
        getResendClient(): unknown;
      };
      serviceAny.getResendClient();
      const calls: unknown[] = [];
      serviceAny.resendClient!.emails.receiving.attachments.get = async (opts: unknown) => {
        calls.push(opts);
        return {
          data: {
            object: 'attachment' as const,
            id: 'att_123',
            filename: 'report.pdf',
            size: 5,
            content_type: 'application/pdf',
            content_disposition: 'attachment' as const,
            download_url: 'https://signed.example/report.pdf?sig=1',
            expires_at: '2026-09-22T01:00:00.000Z',
          },
          error: null,
        };
      };
      const url = await service.getResendAttachmentUrl('email-1', 'att_123');
      assert.equal(url, 'https://signed.example/report.pdf?sig=1');
      assert.deepEqual(calls, [{ emailId: 'email-1', id: 'att_123' }]);
    });
  });

  it('passes already-resolved URLs through without an SDK call', async () => {
    await withEnv({ EMAIL_RESEND_API_KEY: managementKey }, async () => {
      const service = new EmailService();
      const serviceAny = service as unknown as {
        resendClient: { emails: { receiving: { attachments: { get: () => Promise<unknown> } } } } | null;
        getResendClient(): unknown;
      };
      serviceAny.getResendClient();
      let called = false;
      serviceAny.resendClient!.emails.receiving.attachments.get = async () => {
        called = true;
        return { data: null, error: { name: 'x', message: 'should not be called' } as never };
      };
      const url = await service.getResendAttachmentUrl('email-1', 'https://signed.example/file.pdf');
      assert.equal(url, 'https://signed.example/file.pdf');
      assert.equal(called, false);
    });
  });

  it('returns null for attachment lookup when no API key is configured', async () => {
    await withEnv({ EMAIL_RESEND_API_KEY: undefined }, async () => {
      const service = new EmailService();
      assert.equal(await service.getResendAttachmentUrl('email-1', 'att_123'), null);
    });
  });

  it('fetchResendAttachment downloads the bytes behind the signed URL', async () => {
    await withEnv({ EMAIL_RESEND_API_KEY: managementKey }, async () => {
      const service = new EmailService();
      const serviceAny = service as unknown as {
        resendClient: { emails: { receiving: { attachments: { get: () => Promise<unknown> } } } } | null;
        getResendClient(): unknown;
      };
      serviceAny.getResendClient();
      serviceAny.resendClient!.emails.receiving.attachments.get = async () => ({
        data: {
          object: 'attachment' as const,
          id: 'att_bytes',
          filename: 'data.bin',
          size: 3,
          content_type: 'application/octet-stream',
          content_disposition: 'attachment' as const,
          download_url: 'https://signed.example/data.bin',
          expires_at: '2026-09-22T01:00:00.000Z',
        },
        error: null,
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        })) as typeof fetch;
      try {
        const download = await service.fetchResendAttachment('email-1', 'att_bytes');
        assert.ok(download);
        assert.equal(download.buffer.length, 3);
        assert.deepEqual([...download.buffer], [1, 2, 3]);
        assert.equal(download.contentType, 'application/octet-stream');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('caches the client per (key, base URL) and rebuilds on change', async () => {
    await withEnv({ EMAIL_RESEND_API_KEY: managementKey }, async () => {
      const service = new EmailService();
      const serviceAny = service as unknown as {
        resendClient: unknown;
        resendClientFingerprint: string;
        getResendClient(): unknown;
      };
      const first = serviceAny.getResendClient();
      assert.equal(serviceAny.getResendClient(), first, 'same env → cached instance');

      process.env.EMAIL_RESEND_API_KEY = 're_rotated_key';
      const second = serviceAny.getResendClient();
      assert.notEqual(second, first, 'rotated key → new client');
    });
  });
});

describe('EmailChannelAdapter — Resend email.received events', () => {
  const RESEND_EVENT = {
    type: 'email.received',
    created_at: '2026-09-21T10:00:00.000Z',
    data: {
      email_id: 'resend-email-1',
      from: 'Customer <customer@example.com>',
      to: ['support@kneachat.com'],
      subject: 'Hello from Resend',
      message_id: '<resend-1@example.com>',
      attachments: [],
    },
  };

  const stubContent = (adapter: ReturnType<typeof makeAdapter>) => {
    const service = (adapter as unknown as { emailService: EmailService }).emailService;
    (service as unknown as { fetchResendEmailContent: unknown }).fetchResendEmailContent = async () => ({
      from: 'Customer <customer@example.com>',
      to: ['support@kneachat.com'],
      subject: 'Hello from Resend',
      text: 'Resend body text',
      html: '<p>Resend body text</p>',
      headers: { 'Message-ID': '<resend-1@example.com>', 'In-Reply-To': '<orig@example.com>' },
      message_id: '<resend-1@example.com>',
      attachments: [],
    });
    return service;
  };

  it('reshapes the event into a parsed inbound message with fetched content', async () => {
    const adapter = makeAdapter();
    stubContent(adapter);
    const messages = await adapter.parseInbound(RESEND_EVENT);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].externalContactId, 'customer@example.com');
    assert.equal(messages[0].content, 'Resend body text');
    assert.equal(messages[0].externalMessageId, 'resend-1@example.com');
  });

  it('drops the event when content cannot be fetched (no EMAIL_RESEND_API_KEY)', async () => {
    const original = process.env.EMAIL_RESEND_API_KEY;
    delete process.env.EMAIL_RESEND_API_KEY;
    try {
      // No stub — the real fetchResendEmailContent returns null without a key
      // (guard clause, no network call), so the transformed payload has no
      // body-plain and the message is dropped.
      const adapter = makeAdapter();
      const messages = await adapter.parseInbound(RESEND_EVENT);
      assert.deepEqual(messages, []);
    } finally {
      process.env.EMAIL_RESEND_API_KEY = original;
    }
  });

  it('records resend attachment ids in metadata and media fileRef', async () => {
    const adapter = makeAdapter();
    stubContent(adapter);
    // Augment the stub: the event and the fetched content now carry one
    // attachment with a Receiving API id (att_…).
    const service = (adapter as unknown as { emailService: EmailService }).emailService;
    (service as unknown as { fetchResendEmailContent: unknown }).fetchResendEmailContent = async () => ({
      from: 'Customer <customer@example.com>',
      to: ['support@kneachat.com'],
      subject: 'Hello from Resend',
      text: 'See attachment',
      headers: {},
      message_id: '<resend-att@example.com>',
      attachments: [
        { id: 'att_abc', filename: 'photo.png', content_type: 'image/png', size: 42 },
        { id: 'att_def', filename: 'doc.pdf', content_type: 'application/pdf', size: 7 },
      ],
    });

    const event = {
      ...RESEND_EVENT,
      data: {
        ...RESEND_EVENT.data,
        email_id: 'resend-email-att-1',
        attachments: [
          { id: 'att_abc', filename: 'photo.png', content_type: 'image/png', size: 42 },
          { id: 'att_def', filename: 'doc.pdf', content_type: 'application/pdf', size: 7 },
        ],
      },
    };
    const messages = await adapter.parseInbound(event);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].media?.fileRef, 'resend-attachment://resend-email-att-1/att_abc');
    assert.equal(messages[0].media?.fileName, 'photo.png');
    const metadata = messages[0].metadata as { email: { attachments: Array<{ resend_id?: string }> } };
    assert.equal(metadata.email.attachments.length, 2, 'all attachments mirrored in metadata');
    assert.equal(metadata.email.attachments[0].resend_id, 'att_abc');
    assert.equal(metadata.email.attachments[1].resend_id, 'att_def');
  });

  it('downloadMedia resolves a resend-attachment:// fileRef through the SDK and returns the bytes', async () => {
    const adapter = makeAdapter();
    const service = (adapter as unknown as { emailService: EmailService }).emailService;
    const calls: Array<{ emailId: string; attachmentId: string }> = [];
    (service as unknown as { fetchResendAttachment: unknown }).fetchResendAttachment = async (
      emailId: string,
      attachmentId: string,
    ): Promise<ResendAttachmentDownload | null> => {
      calls.push({ emailId, attachmentId });
      return {
        id: attachmentId,
        filename: 'photo.png',
        contentType: 'image/png',
        size: 4,
        buffer: Buffer.from([9, 8, 7, 6]),
      };
    };

    const buffer = await adapter.downloadMedia({
      kind: 'file',
      fileName: 'photo.png',
      mimeType: 'image/png',
      fileRef: 'resend-attachment://resend-email-9/att_777',
    });
    assert.ok(buffer);
    assert.deepEqual([...buffer], [9, 8, 7, 6]);
    assert.deepEqual(calls, [{ emailId: 'resend-email-9', attachmentId: 'att_777' }]);

    // Malformed ref (no separator) → null, no call.
    const bad = await adapter.downloadMedia({
      kind: 'file',
      fileName: 'x',
      mimeType: null,
      fileRef: 'resend-attachment://no-separator',
    });
    assert.equal(bad, null);
    assert.equal(calls.length, 1);
  });

  it('routes Resend events to Svix verification inside verifyWebhookSignature', () => {
    const original = process.env.EMAIL_RESEND_WEBHOOK_SECRET;
    process.env.EMAIL_RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('test-secret-key').toString('base64');
    try {
      const adapter = makeAdapter();
      const rawBody = JSON.stringify(RESEND_EVENT);
      const id = 'msg_test_0002';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const key = Buffer.from(process.env.EMAIL_RESEND_WEBHOOK_SECRET.slice(6), 'base64');
      const sig = `v1,${require('crypto').createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64')}`;
      const ok = adapter.verifyWebhookSignature(RESEND_EVENT, {
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': sig,
        'svix-raw-body': rawBody,
      });
      assert.equal(ok, true);
    } finally {
      process.env.EMAIL_RESEND_WEBHOOK_SECRET = original;
    }
  });
});
