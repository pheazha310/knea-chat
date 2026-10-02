'use strict';

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Response } from 'express';

import { EmailController } from '../src/integrations/email/email.controller';

/**
 * The disabled-webhook branch used to answer a silent 204 (console.info only),
 * which cost a real debugging session: the server had loaded .env before
 * EMAIL_INBOUND_ENABLED was added and every inbound delivery was dropped with
 * no visible trace. These tests pin the loud behavior: a warning block on
 * stdout AND an X-Email-Inbound-Disabled response header.
 */
describe('email controller — disabled inbound webhook', () => {
  let snapshot: NodeJS.ProcessEnv;
  let warnCalls: string[];

  const makeRes = () => {
    let status = 0;
    let header = '';
    const res = {
      set: (name: string, value: string) => {
        header = `${name}=${value}`;
        return res;
      },
      sendStatus: (code: number) => {
        status = code;
        return res;
      },
    } as unknown as Response;
    return { res, getStatus: () => status, getHeader: () => header };
  };

  beforeEach(() => {
    snapshot = { ...process.env };
    delete process.env.EMAIL_INBOUND_ENABLED;
    warnCalls = [];
    mock.method(console, 'warn', (...args: unknown[]) => {
      warnCalls.push(args.map(String).join(' '));
    });
    mock.method(console, 'log', () => {});
    mock.method(console, 'error', () => {});
  });

  afterEach(() => {
    mock.restoreAll();
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) delete process.env[key];
    }
    Object.assign(process.env, snapshot);
  });

  it('responds 204 with the disabled header and a loud warning naming the fix', async () => {
    const controller = new EmailController({} as never, {} as never);
    const { res, getStatus, getHeader } = makeRes();

    await controller.webhook({ headers: {}, body: {} } as never, res);

    assert.equal(getStatus(), 204);
    assert.equal(getHeader(), 'X-Email-Inbound-Disabled=1');
    assert.equal(warnCalls.length, 1, 'exactly one warning block');
    assert.match(warnCalls[0], /Inbound webhook delivery DROPPED/);
    assert.match(warnCalls[0], /EMAIL_INBOUND_ENABLED/);
    assert.match(warnCalls[0], /restart the server/, 'stale-env remediation must be spelled out');
  });

  it('stays quiet (no header, no drop warning) when inbound is enabled', async () => {
    process.env.EMAIL_INBOUND_ENABLED = 'true';
    process.env.EMAIL_WEBHOOK_SECRET = 'test-secret';
    const adapter = {
      verifyWebhookSignature: async () => true,
      parseInbound: async () => [],
    };
    const controller = new EmailController({ processInbound: async () => ({ processed: 0, ignored: 0 }) } as never, adapter as never);
    const { res, getStatus, getHeader } = makeRes();

    await controller.webhook({ headers: {}, body: {} } as never, res);

    assert.equal(getStatus(), 200, 'no parsed messages → plain 200 ack (the enabled path)');
    assert.equal(getHeader(), '', 'disabled header must not be set on the healthy path');
    assert.equal(warnCalls.length, 0, 'no warning when the pipeline is healthy');
  });
});
