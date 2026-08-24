/**
 * Rate limiting middleware.
 * Simple in-memory sliding window per IP + optional per-key.
 * SRS §19: "Rate limiting should be applied to authentication and abuse-prone endpoints."
 */
import type { Request, RequestHandler, Response } from 'express';

const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);

const buckets = new Map<string, number[]>();

interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  keyGenerator?: (req: Request) => string;
}

export const rateLimit = (options: RateLimitOptions = {}): RequestHandler => {
  const windowMs = options.windowMs || RATE_LIMIT_WINDOW_MS;
  const max = options.max || RATE_LIMIT_MAX_REQUESTS;
  const keyGenerator = options.keyGenerator || ((req: Request) => req.ip || 'unknown');

  return (req: Request, res: Response, next: () => void) => {
    const key = keyGenerator(req);
    const now = Date.now();

    if (!buckets.has(key)) {
      buckets.set(key, []);
    }

    const timestamps = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    buckets.set(key, timestamps);

    if (timestamps.length >= max) {
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

/** Background cleanup so the map does not grow unbounded. */
setInterval(() => {
  const now = Date.now();
  buckets.forEach((timestamps, key) => {
    const fresh = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (fresh.length === 0) {
      buckets.delete(key);
    } else {
      buckets.set(key, fresh);
    }
  });
}, 10 * 60 * 1000).unref();
