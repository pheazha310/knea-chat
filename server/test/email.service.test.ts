'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSmtpTransportOptions,
  describeSmtpError,
  EmailService,
  generateMessageId,
} from '../src/integrations/email/email.service';

describe('buildSmtpTransportOptions', () => {
  it('returns null when no SMTP host is configured', () => {
    assert.equal(buildSmtpTransportOptions({}), null);
    assert.equal(buildSmtpTransportOptions({ EMAIL_SMTP_HOST: '  ' }), null);
  });

  it('builds an unauthenticated transport for Mailpit (host + port only)', () => {
    assert.deepEqual(
      buildSmtpTransportOptions({ EMAIL_SMTP_HOST: 'localhost', EMAIL_SMTP_PORT: '1025', EMAIL_SMTP_SECURE: 'false' }),
      { host: 'localhost', port: 1025, secure: false },
    );
  });

  it('attaches credentials only when both user and pass are present', () => {
    const withAuth = buildSmtpTransportOptions({
      EMAIL_SMTP_HOST: 'smtp.gmail.com',
      EMAIL_SMTP_USER: 'agent@example.com',
      EMAIL_SMTP_PASS: 'app-password',
    });
    assert.deepEqual(withAuth, {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: 'agent@example.com', pass: 'app-password' },
    });

    const userOnly = buildSmtpTransportOptions({ EMAIL_SMTP_HOST: 'smtp.gmail.com', EMAIL_SMTP_USER: 'agent@example.com' });
    assert.equal(userOnly?.auth, undefined);
  });

  it('enables implicit TLS only for EMAIL_SMTP_SECURE=true', () => {
    assert.equal(buildSmtpTransportOptions({ EMAIL_SMTP_HOST: 'smtp.resend.com', EMAIL_SMTP_PORT: '465', EMAIL_SMTP_SECURE: 'true' })?.secure, true);
    assert.equal(buildSmtpTransportOptions({ EMAIL_SMTP_HOST: 'smtp.resend.com', EMAIL_SMTP_SECURE: 'yes' })?.secure, false);
  });
});

describe('describeSmtpError', () => {
  it('maps Nodemailer error codes to agent-safe reasons', () => {
    assert.match(describeSmtpError({ code: 'EAUTH', message: '535 5.7.8 user@corp.com bad password' }), /rejected the login/);
    assert.equal(describeSmtpError({ code: 'ETIMEDOUT' }), 'Email server timed out');
    assert.equal(describeSmtpError({ code: 'ECONNECTION' }), 'Could not connect to the email server');
    assert.equal(describeSmtpError({ code: 'EENVELOPE' }), 'Recipient address was rejected');
    assert.equal(describeSmtpError({ responseCode: 550 }), 'Recipient address was rejected');
    assert.equal(describeSmtpError({ responseCode: 421 }), 'Email provider rejected the message');
    assert.equal(describeSmtpError(new Error('mx1.internal.corp exploded')), 'Email delivery failed');
  });
});

describe('generateMessageId', () => {
  it('returns a unique, normalized id on the From domain', () => {
    const a = generateMessageId();
    const b = generateMessageId();
    assert.notEqual(a, b);
    assert.match(a, /^[0-9a-f-]{36}@[a-z0-9.-]+$/);
    assert.ok(!a.includes('<'));
  });
});

describe('EmailService.sendMail', () => {
  /** EmailService with a stub transport that records what Nodemailer would send. */
  const withStubTransport = (sendMail: (opts: Record<string, unknown>) => Promise<unknown>) => {
    const service = new EmailService();
    (service as unknown as { transporter: unknown }).transporter = { sendMail };
    return service;
  };

  it('uses the supplied Message-ID without overwriting References', async () => {
    let captured: Record<string, unknown> = {};
    const service = withStubTransport(async (opts) => {
      captured = opts;
      return { messageId: opts.messageId, accepted: ['c@example.com'], rejected: [] };
    });

    const result = await service.sendMail({
      from: { address: 'support@kneachat.com' },
      to: { address: 'c@example.com' },
      subject: '',
      text: 'hi',
      messageId: 'abc@kneachat.com',
      threading: { subject: 'Order #42', inReplyTo: 'm2@x.com', references: ['m1@x.com'] },
    });

    assert.equal(result.ok, true);
    assert.equal(captured.messageId, '<abc@kneachat.com>');
    assert.equal(captured.inReplyTo, '<m2@x.com>');
    assert.equal(captured.references, '<m1@x.com> <m2@x.com>');
    assert.equal(captured.subject, 'Re: Order #42');
  });

  it('returns a sanitized description when SMTP fails', async () => {
    const service = withStubTransport(async () => {
      throw Object.assign(new Error('Invalid login: 535 user@corp.com'), { code: 'EAUTH', responseCode: 535 });
    });
    const originalError = console.error;
    console.error = () => {};
    try {
      const result = await service.sendMail({
        from: { address: 'support@kneachat.com' },
        to: { address: 'c@example.com' },
        subject: 'x',
        text: 'hi',
      });
      assert.equal(result.ok, false);
      assert.ok(!String(result.description).includes('corp.com'), 'raw SMTP text never leaks');
    } finally {
      console.error = originalError;
    }
  });
});
