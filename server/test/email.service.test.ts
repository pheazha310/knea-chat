'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildSmtpTransportOptions } from '../src/integrations/email/email.service';

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
