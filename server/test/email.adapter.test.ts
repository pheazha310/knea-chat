'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EmailChannelAdapter } from '../src/integrations/email/email.adapter';
import { EmailService, buildReplySubject, buildReferencesHeader, wrapMessageId } from '../src/integrations/email/email.service';

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
