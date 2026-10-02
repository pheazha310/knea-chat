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

/** Fail-closed webhook verification (security phase). */
describe('email controller — webhook verification gate', () => {
  let snapshot: NodeJS.ProcessEnv;

  const makeRes = () => {
    const state = { status: 0, body: undefined as unknown };
    const res = {
      set: () => res,
      status: (code: number) => {
        state.status = code;
        return res;
      },
      json: (body: unknown) => {
        state.body = body;
        return res;
      },
      sendStatus: (code: number) => {
        state.status = code;
        return res;
      },
    } as unknown as Response;
    return { res, state };
  };

  /** Adapter + engine fakes that record whether verification / processing ran. */
  const makeController = () => {
    const calls = { verified: 0, processed: 0 };
    const adapter = {
      verifyWebhookSignature: async () => {
        calls.verified += 1;
        return true;
      },
      parseInbound: async () => [{ externalMessageId: 'm1' }],
    };
    const engine = {
      processInbound: async () => {
        calls.processed += 1;
        return { processed: 1, ignored: 0 };
      },
    };
    return { controller: new EmailController(engine as never, adapter as never), calls };
  };

  beforeEach(() => {
    snapshot = { ...process.env };
    process.env.EMAIL_INBOUND_ENABLED = 'true';
    delete process.env.EMAIL_WEBHOOK_SECRET;
    delete process.env.EMAIL_RESEND_WEBHOOK_SECRET;
    delete process.env.EMAIL_WEBHOOK_ALLOW_UNSIGNED;
    mock.method(console, 'warn', () => {});
    mock.method(console, 'error', () => {});
  });

  afterEach(() => {
    mock.restoreAll();
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) delete process.env[key];
    }
    Object.assign(process.env, snapshot);
  });

  it('rejects with 503 and persists nothing when no secret is configured', async () => {
    const { controller, calls } = makeController();
    const { res, state } = makeRes();

    await controller.webhook({ headers: {}, body: {} } as never, res);

    assert.equal(state.status, 503);
    assert.equal(calls.processed, 0, 'a forged email must never reach the inbox');
  });

  it('accepts unsigned requests only with the explicit non-production opt-in', async () => {
    process.env.EMAIL_WEBHOOK_ALLOW_UNSIGNED = 'true';
    process.env.NODE_ENV = 'development';
    const { controller, calls } = makeController();
    const { res, state } = makeRes();

    await controller.webhook({ headers: {}, body: {} } as never, res);

    assert.equal(state.status, 200);
    assert.equal(calls.processed, 1);
  });

  it('ignores the opt-in in production', async () => {
    process.env.EMAIL_WEBHOOK_ALLOW_UNSIGNED = 'true';
    process.env.NODE_ENV = 'production';
    const { controller, calls } = makeController();
    const { res, state } = makeRes();

    await controller.webhook({ headers: {}, body: {} } as never, res);

    assert.equal(state.status, 503);
    assert.equal(calls.processed, 0);
  });

  it('verifies signatures when only the Resend secret is set', async () => {
    process.env.EMAIL_RESEND_WEBHOOK_SECRET = 'whsec_dGVzdA==';
    const { controller, calls } = makeController();
    const { res } = makeRes();

    await controller.webhook({ headers: {}, body: {} } as never, res);

    assert.equal(calls.verified, 1, 'the Resend secret alone must enable verification');
  });
});
