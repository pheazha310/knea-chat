/**
 * Rate limiting middleware.
 * Simple in-memory sliding window per IP + optional per-key.
 * SRS §19: "Rate limiting should be applied to authentication and abuse-prone endpoints."
 *
 * Every limiter owns its own bucket map, so two limiters keyed by the same IP
 * (e.g. login and the email webhook) never consume each other's budget.
 */
import type { Request, RequestHandler, Response } from 'express';

const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);

interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  keyGenerator?: (req: Request) => string;
}

/** Live limiters, swept by the background cleanup below. */
const limiters = new Set<{ buckets: Map<string, number[]>; windowMs: number }>();

export const rateLimit = (options: RateLimitOptions = {}): RequestHandler => {
  const windowMs = options.windowMs || RATE_LIMIT_WINDOW_MS;
  const max = options.max || RATE_LIMIT_MAX_REQUESTS;
  const keyGenerator = options.keyGenerator || ((req: Request) => req.ip || 'unknown');
  const buckets = new Map<string, number[]>();
  limiters.add({ buckets, windowMs });

  return (req: Request, res: Response, next: () => void) => {
    const key = keyGenerator(req);
    const now = Date.now();

    const timestamps = (buckets.get(key) || []).filter((t) => now - t < windowMs);

    if (timestamps.length >= max) {
      buckets.set(key, timestamps);
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.',
        errors: { rateLimit: 'Rate limit exceeded' },
      });
      return;
    }

    timestamps.push(now);
    buckets.set(key, timestamps);
    next();
  };
};

/** Background cleanup so the maps do not grow unbounded. */
setInterval(() => {
  const now = Date.now();
  limiters.forEach(({ buckets, windowMs }) => {
    buckets.forEach((timestamps, key) => {
      const fresh = timestamps.filter((t) => now - t < windowMs);
      if (fresh.length === 0) {
        buckets.delete(key);
      } else {
        buckets.set(key, fresh);
      }
    });
  });
}, 10 * 60 * 1000).unref();

/**
 * Outbound omni-channel replies, per agent (shared by /api/omni and
 * /api/email send routes so both draw from one budget). Caps the damage a
 * stolen session or a stuck client can do to the SMTP account's reputation.
 * Must run after `auth.authenticate`.
 */
export const agentSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => `agent:${req.user?.id ?? req.ip ?? 'unknown'}`,
});

/**
 * Public inbound webhooks, per source IP. Generous enough for a provider
 * flushing a retry backlog; a 429 makes the provider retry later, so no
 * email is lost — it only slows a flood of forged requests.
 */
export const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
