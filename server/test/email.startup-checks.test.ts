'use strict';

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  getInboundDomain,
  isEmailInboundConfigured,
  isQuickTunnelUrl,
  resolveMxRecords,
  runEmailStartupChecks,
} from '../src/integrations/email/startup-checks';

describe('email startup checks — configuration detection', () => {
  let snapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    snapshot = { ...process.env };
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) delete process.env[key];
    }
    Object.assign(process.env, snapshot);
  });

  it('defaults the inbound domain to kneachat.com', () => {
    delete process.env.EMAIL_INBOUND_DOMAIN;
    assert.equal(getInboundDomain(), 'kneachat.com');
  });

  it('normalizes the configured inbound domain', () => {
    process.env.EMAIL_INBOUND_DOMAIN = '  Support.KneaChat.COM ';
    assert.equal(getInboundDomain(), 'support.kneachat.com');
  });

  it('is not configured without the webhook secret', () => {
    delete process.env.EMAIL_WEBHOOK_SECRET;
    process.env.EMAIL_INBOUND_DOMAIN = 'kneachat.com';
    assert.equal(isEmailInboundConfigured(), false);
  });

  it('is configured with secret + domain', () => {
    process.env.EMAIL_WEBHOOK_SECRET = 'whsec-test';
    process.env.EMAIL_INBOUND_DOMAIN = 'kneachat.com';
    assert.equal(isEmailInboundConfigured(), true);
  });
});

describe('email startup checks — quick tunnel detection', () => {
  it('flags trycloudflare.com quick-tunnel URLs', () => {
    assert.equal(
      isQuickTunnelUrl('https://ottawa-word-chorus-guitar.trycloudflare.com/api/email/webhook'),
      true,
    );
  });

  it('accepts stable webhook hosts', () => {
    assert.equal(isQuickTunnelUrl('https://api.kneachat.com/api/email/webhook'), false);
    assert.equal(isQuickTunnelUrl('http://127.0.0.1:8080/api/email/webhook'), false);
  });
});

describe('email startup checks — MX resolution', () => {
  it('returns records for a domain that has MX entries', async () => {
    // resend.dev resolves to Amazon SES inbound MX — stable public records.
    const records = await resolveMxRecords('resend.dev');
    assert.ok(records && records.length > 0, 'expected MX records for resend.dev');
    assert.ok(records[0].exchange.length > 0);
    assert.ok(Number.isFinite(records[0].priority));
  });

  it('returns null for a nonexistent domain', async () => {
    const records = await resolveMxRecords('does-not-exist-kneachat-test.invalid');
    assert.equal(records, null);
  });
});

describe('email startup checks — runEmailStartupChecks', () => {
  let snapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    snapshot = { ...process.env };
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) delete process.env[key];
    }
    Object.assign(process.env, snapshot);
  });

  it('reports the MX problem and stops at the missing webhook URL', async () => {
    process.env.EMAIL_INBOUND_DOMAIN = 'does-not-exist-kneachat-test.invalid';
    delete process.env.EMAIL_WEBHOOK_URL;

    const findings = await runEmailStartupChecks();
    assert.equal(findings.length, 2);
    assert.equal(findings[0].check, 'mx');
    assert.equal(findings[0].problem, true);
    assert.equal(findings[1].check, 'webhook-url');
    assert.equal(findings[1].problem, true);
  });

  it('passes every check against a healthy mock webhook host', async () => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 'ok' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      process.env.EMAIL_INBOUND_DOMAIN = 'resend.dev';
      process.env.EMAIL_WEBHOOK_URL = `http://127.0.0.1:${port}/api/email/webhook`;

      const findings = await runEmailStartupChecks();
      const byCheck = new Map(findings.map((f) => [f.check, f]));
      assert.equal(byCheck.get('mx')?.problem, false);
      assert.equal(byCheck.get('webhook-url')?.problem, false);
      assert.equal(byCheck.get('webhost-ok')?.problem, false);
      assert.match(byCheck.get('webhost-ok')?.detail ?? '', /→ 200$/);
    } finally {
      server.close();
    }
  });

  it('flags an unreachable webhook host', async () => {
    process.env.EMAIL_INBOUND_DOMAIN = 'resend.dev';
    // Port 1 on loopback refuses connections immediately (no 10s wait).
    process.env.EMAIL_WEBHOOK_URL = 'http://127.0.0.1:1/api/email/webhook';

    const findings = await runEmailStartupChecks();
    const host = findings.find((f) => f.check === 'webhook-host');
    assert.equal(host?.problem, true);
    assert.match(host?.detail ?? '', /unreachable/);
  });
});
