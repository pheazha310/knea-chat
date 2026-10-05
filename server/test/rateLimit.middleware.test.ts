'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';

import { rateLimit } from '../src/middleware/rateLimit.middleware';

/** Run a limiter once for `ip`; returns the HTTP status (200 = passed through). */
const hit = (limiter: ReturnType<typeof rateLimit>, ip: string, userId?: number): number => {
  let status = 200;
  const res = {
    setHeader: () => res,
    status: (code: number) => {
      status = code;
      return res;
    },
    json: () => res,
  } as unknown as Response;
  limiter({ ip, user: userId ? { id: userId } : undefined } as unknown as Request, res, () => {});
  return status;
};

describe('rateLimit', () => {
  it('answers 429 once the window budget is spent', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2 });
    assert.equal(hit(limiter, '1.1.1.1'), 200);
    assert.equal(hit(limiter, '1.1.1.1'), 200);
    assert.equal(hit(limiter, '1.1.1.1'), 429);
    assert.equal(hit(limiter, '2.2.2.2'), 200, 'other IPs are unaffected');
  });

  it('keeps separate budgets per limiter for the same IP', () => {
    // Regression: all limiters used to share one IP-keyed map, so logins
    // consumed the webhook's budget (and vice versa).
    const login = rateLimit({ windowMs: 60_000, max: 1 });
    const webhook = rateLimit({ windowMs: 60_000, max: 1 });
    assert.equal(hit(login, '3.3.3.3'), 200);
    assert.equal(hit(webhook, '3.3.3.3'), 200, 'webhook budget untouched by the login');
    assert.equal(hit(login, '3.3.3.3'), 429);
  });

  it('supports per-user keys', () => {
    const perAgent = rateLimit({ windowMs: 60_000, max: 1, keyGenerator: (req) => `agent:${req.user?.id}` });
    assert.equal(hit(perAgent, '4.4.4.4', 1), 200);
    assert.equal(hit(perAgent, '4.4.4.4', 2), 200, 'a second agent behind the same IP is not blocked');
    assert.equal(hit(perAgent, '4.4.4.4', 1), 429);
  });
});
