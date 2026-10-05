/**
 * Email channel configuration — the one place that turns `server/.env` into
 * typed settings for SMTP, the sender identity and webhook verification.
 *
 * Every function takes `env` and reads it at CALL time (not import time), so
 * values are always current after dotenv loads and tests can pass their own.
 * Nothing here is ever sent to the browser: React only talks to the REST API.
 *
 * Provider-API settings (EMAIL_RESEND_*) stay next to the Resend code in
 * integrations/email/email.service.ts.
 */

export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
}

/**
 * SMTP transport options from the environment, or null when no host is set.
 *
 * Only the host is required. Credentials are attached when BOTH user and pass
 * are present — local catchers like Mailpit (localhost:1025) accept mail
 * without authentication, while real providers (Gmail, Resend) reject the
 * unauthenticated send with an SMTP auth error at delivery time.
 */
export function buildSmtpTransportOptions(env: NodeJS.ProcessEnv = process.env): SmtpTransportOptions | null {
  const host = env.EMAIL_SMTP_HOST?.trim();
  if (!host) return null;

  const options: SmtpTransportOptions = {
    host,
    port: parseInt(env.EMAIL_SMTP_PORT || '587', 10),
    secure: env.EMAIL_SMTP_SECURE === 'true',
  };
  const user = env.EMAIL_SMTP_USER;
  const pass = env.EMAIL_SMTP_PASS;
  if (user && pass) {
    options.auth = { user, pass };
  }
  return options;
}

/** The From identity on every outbound email. */
export function getSenderConfig(env: NodeJS.ProcessEnv = process.env): { name: string; address: string } {
  return {
    name: env.EMAIL_FROM_NAME || 'KneaChat',
    address: env.EMAIL_FROM || 'noreply@kneachat.com',
  };
}

/** Optional address where customer replies should be delivered. */
export function getReplyToAddress(env: NodeJS.ProcessEnv = process.env): string | null {
  const address = env.EMAIL_REPLY_TO?.trim();
  return address || null;
}

/**
 * Inbound webhook verification settings.
 *   - `secretConfigured`: either the generic secret or Resend's `whsec_`
 *     secret is set, so signatures can be checked.
 *   - `allowUnsigned`: local-testing escape hatch for curl — honoured only
 *     outside production.
 */
export function getWebhookVerificationConfig(env: NodeJS.ProcessEnv = process.env): {
  secretConfigured: boolean;
  allowUnsigned: boolean;
} {
  return {
    secretConfigured: !!(env.EMAIL_WEBHOOK_SECRET || env.EMAIL_RESEND_WEBHOOK_SECRET),
    allowUnsigned: env.EMAIL_WEBHOOK_ALLOW_UNSIGNED === 'true' && env.NODE_ENV !== 'production',
  };
}
