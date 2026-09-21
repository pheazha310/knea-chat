/**
 * EmailService — SMTP client and webhook utilities for the email omni-channel adapter.
 *
 * Responsibilities:
 *   - Outbound: SMTP delivery via nodemailer (text + HTML + attachments).
 *   - Inbound: webhook payload normalization + signature verification.
 *   - Threading: extract Message-ID / In-Reply-To / References.
 *   - Sanitization: strip dangerous HTML before persisting inbound content.
 *
 * Configuration is driven entirely by environment variables (no secrets logged).
 */
import nodemailer, { type Transporter, type SentMessageInfo, type SendMailOptions } from 'nodemailer';
import crypto from 'crypto';

import type {
  EmailAddress,
  EmailSendOptions,
  EmailSendResult,
  EmailWebhookHeaders,
  EmailWebhookPayload,
  EmailHealthInfo,
} from './email.types';

const getWebhookSecret = (): string => process.env.EMAIL_WEBHOOK_SECRET || '';
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM || 'noreply@kneachat.com';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'KneaChat';

/**
 * Email threading (RFC 5322) — derive the outbound reply headers from the
 * original message. A missing `Re:` prefix is added so the customer's mail
 * client groups the reply with the original thread; Message-IDs are wrapped
 * in `<>` when the provider normalized them away.
 */
export function buildReplySubject(subject: string | null | undefined): string {
  const trimmed = (subject || '').trim();
  if (!trimmed) return 'Message from KneaChat';
  return /^re\s*:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

export function wrapMessageId(messageId: string | null | undefined): string | null {
  const trimmed = (messageId || '').trim();
  if (!trimmed) return null;
  return trimmed.startsWith('<') ? trimmed : `<${trimmed}>`; 
}

export function buildReferencesHeader(
  references: string | string[] | null | undefined,
  inReplyTo?: string | null,
): string | null {
  const list: string[] = [];
  const push = (value?: string | null) => {
    const wrapped = wrapMessageId(value);
    // Deduplicate: RFC 5322 chains list each ancestor once, and inReplyTo is
    // normally already the last References entry.
    if (wrapped && !list.includes(wrapped)) list.push(wrapped);
  };
  if (Array.isArray(references)) {
    for (const ref of references) push(ref);
  } else if (references) {
    for (const ref of references.split(/\s+/)) push(ref);
  }
  push(inReplyTo);
  return list.length > 0 ? list.join(' ') : null;
}

export function buildThreadingHeaders(threading: EmailSendOptions['threading']): {
  subject: string;
  inReplyTo?: string;
  references?: string;
} {
  const subject = buildReplySubject(threading?.subject);
  const inReplyTo = wrapMessageId(threading?.inReplyTo) || undefined;
  const references = buildReferencesHeader(threading?.references, threading?.inReplyTo) || undefined;
  return { subject, ...(inReplyTo ? { inReplyTo } : {}), ...(references ? { references } : {}) };
}

export function getFromAddress(): EmailAddress {
  return { name: EMAIL_FROM_NAME || undefined, address: EMAIL_FROM_ADDRESS };
}

/** Minimal HTML sanitizer: strips script tags, event handlers, and dangerous protocols. */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/vbscript:/gi, '')
    .replace(/data:text\/html/gi, '');
}

/** Normalize an email address (lowercase, trim). */
export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

/** Build a text fallback from HTML by stripping tags. */
export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Normalize provider attachment arrays into the canonical webhook shape.
 * Accepts Mailgun's JSON-encoded string, plain arrays, and tolerates the
 * `filename`/`type`/`contentType` field-name variants providers use.
 */
export function normalizeAttachments(
  raw: unknown,
): EmailWebhookPayload['attachments'] {
  if (!raw) return undefined;
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(list)) return undefined;
  const normalized = list
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      name: String(a['name'] ?? a['filename'] ?? a['fileName'] ?? 'attachment'),
      content_type: String(
        a['content_type'] ?? a['contentType'] ?? a['type'] ?? 'application/octet-stream',
      ),
      ...(a['size'] != null && Number.isFinite(Number(a['size']))
        ? { size: Number(a['size']) }
        : {}),
      ...(a['url'] ? { url: String(a['url']) } : {}),
    }));
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * SendGrid Inbound Parse posts `attachments` as attachment ids plus an
 * `attachment-info` JSON map ({ id: { filename, type, size } }). The file
 * bytes arrive inline in the multipart post, so there is no URL to fetch.
 */
export function normalizeSendGridInboundAttachments(
  body: Record<string, unknown>,
): EmailWebhookPayload['attachments'] {
  const info = body['attachment-info'];
  if (!info || typeof info !== 'object') return undefined;
  const map = info as Record<string, Record<string, unknown>>;
  const rawIds = body['attachments'];
  const ids = Array.isArray(rawIds)
    ? rawIds.map(String)
    : typeof rawIds === 'string'
      ? rawIds.split(/[\s,]+/).filter(Boolean)
      : [];
  const normalized = ids
    .map((id) => map[id])
    .filter((meta): meta is Record<string, unknown> => !!meta)
    .map((meta) => ({
      name: String(meta['filename'] ?? 'attachment'),
      content_type: String(meta['type'] ?? 'application/octet-stream'),
      ...(meta['size'] != null && Number.isFinite(Number(meta['size']))
        ? { size: Number(meta['size']) }
        : {}),
    }));
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Parse Mailgun's `message-headers` — a JSON-encoded array of
 * [name, value] pairs — into a lowercase-keyed map (empty on malformed input).
 */
export function parseHeaderPairs(raw: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return headers;
    }
  }
  if (!Array.isArray(list)) return headers;
  for (const entry of list) {
    if (Array.isArray(entry) && entry.length >= 2) {
      headers[String(entry[0]).toLowerCase()] = String(entry[1] ?? '');
    }
  }
  return headers;
}

export class EmailService {
  private transporter: Transporter | null = null;
  private configured = false;

  constructor() {
    const host = process.env.EMAIL_SMTP_HOST;
    const port = parseInt(process.env.EMAIL_SMTP_PORT || '587', 10);
    const user = process.env.EMAIL_SMTP_USER;
    const pass = process.env.EMAIL_SMTP_PASS;
    const secure = process.env.EMAIL_SMTP_SECURE === 'true';

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });
      this.configured = true;
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getFromAddress(): EmailAddress {
    return { name: EMAIL_FROM_NAME || undefined, address: EMAIL_FROM_ADDRESS };
  }

  sanitizeHtml(html: string): string {
    if (!html) return '';
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/vbscript:/gi, '')
      .replace(/data:text\/html/gi, '');
  }

  normalizeEmailAddress(email: string): string {
    return email.trim().toLowerCase();
  }

  htmlToText(html: string): string {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async sendMail(options: EmailSendOptions): Promise<EmailSendResult> {
    if (!this.transporter) {
      return { ok: false, description: 'SMTP is not configured' };
    }

    try {
      const from =
        typeof options.from === 'string'
          ? options.from
          : `${options.from.name ? `${options.from.name} <${options.from.address}>` : options.from.address}`;

      const to = Array.isArray(options.to)
        ? options.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ')
        : typeof options.to === 'string'
          ? options.to
          : `${options.to.name ? `${options.to.name} <${options.to.address}>` : options.to.address}`;

      const mailOptions: SendMailOptions = {
        from,
        to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        headers: options.headers,
        attachments: options.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      };

      if (options.threading?.inReplyTo || options.threading?.references) {
        // Structured threading wins when present (adapter-supplied).
        const threading = buildThreadingHeaders(options.threading);
        mailOptions.subject = threading.subject;
        if (threading.inReplyTo) mailOptions.inReplyTo = threading.inReplyTo;
        if (threading.references) mailOptions.references = threading.references;
      } else if (options.replyTo) {
        mailOptions.inReplyTo = options.replyTo;
      }
      if (options.messageId) {
        mailOptions.references = options.references || options.messageId;
        mailOptions.messageId = options.messageId;
      }

      const info: SentMessageInfo = await this.transporter.sendMail(mailOptions);

      return {
        ok: true,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
      };
    } catch (error) {
      const description = error instanceof Error ? error.message : 'SMTP delivery failed';
      return { ok: false, description };
    }
  }

  verifyWebhookSignature(payload: unknown, headers: EmailWebhookHeaders): boolean {
    const secret = getWebhookSecret();
    if (!secret) {
      console.warn('[email] EMAIL_WEBHOOK_SECRET is not set — webhook is unprotected');
      return true;
    }    const provider = (headers.provider || '').toLowerCase();

    // SendGrid: X-Twilio-Email-Event-Webhook-Signature + X-Twilio-Email-Event-Webhook-Timestamp
    if (provider === 'sendgrid' || headers['x-twilio-email-event-webhook-signature']) {
      const signature = headers['x-twilio-email-event-webhook-signature'];
      const timestamp = headers['x-twilio-email-event-webhook-timestamp'];
      if (!signature || !timestamp) return false;
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const signed = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}\n${payloadStr}`)
        .digest('base64');
      return this.safeCompare(signed, signature);
    }

    // Mailgun: signature-timestamp + token + signature in body
    if (provider === 'mailgun') {
      const body = payload as Record<string, unknown>;
      const signature = headers['x-mailgun-signature'];
      const timestamp = headers['x-mailgun-timestamp'];
      const token = headers['x-mailgun-token'];
      if (!signature || !timestamp || !token) return false;
      const hmac = crypto.createHmac('sha256', secret).update(`${timestamp}${token}`).digest('hex');
      return this.safeCompare(hmac, signature);
    }

    // Postmark: X-Postmark-Webhook signaure via public key verification
    if (provider === 'postmark' || headers['x-postmark-webhook-signature']) {
      const signature = headers['x-postmark-webhook-signature'] || headers['signature'];
      if (!signature) return false;
      return this.verifyWithPublicKey(signature, payload);
    }

    // SES: X-Amz-Sns-Message-Type indicates SNS; actual verification is done in controller
    if (provider === 'ses') {
      return true;
    }

    // Generic HMAC-SHA256
    const signature = headers.signature;
    if (!signature) return false;
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('base64');
    return this.safeCompare(hmac, signature);
  }

  /**
   * Constant-time string comparison of two hex/base64 signatures that never
   * throws when the attacker-controlled value has a different length (which
   * crypto.timingSafeEqual would).
   */
  private safeCompare(expected: string, received: string): boolean {
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /**
   * Verify a provider signature with an RSA/ECDSA public key (SendGrid Event
   * Webhook, Postmark). Returns false when EMAIL_WEBHOOK_PUBLIC_KEY is unset,
   * malformed, or the signature does not verify.
   */
  private verifyWithPublicKey(signature: string, payload: unknown): boolean {
    const publicKey = process.env.EMAIL_WEBHOOK_PUBLIC_KEY || '';
    if (!publicKey) {
      console.warn('[email] EMAIL_WEBHOOK_PUBLIC_KEY is not set — cannot verify provider signature');
      return false;
    }
    try {
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const verifier = crypto.createVerify('SHA256');
      verifier.update(payloadStr);
      verifier.end();
      return verifier.verify(
        publicKey.replace(/\\n/g, '\n'),
        Buffer.from(signature, 'base64'),
      );
    } catch {
      return false;
    }
  }

  parseWebhookPayload(payload: unknown): EmailWebhookPayload | null {
    if (!payload || typeof payload !== 'object') return null;

    const data = payload as Record<string, unknown>;

    // SendGrid v3 mail send event
    if (data['mail'] && typeof data['mail'] === 'object') {
      const mail = data['mail'] as Record<string, unknown>;
      const sender = (mail['from'] as string) || '';
      const to = (mail['to'] as string) || '';
      const subject = (mail['subject'] as string) || '';
      const content = (mail['content'] as Array<Record<string, string>>) || [];
      const text = content.find((c) => c['type'] === 'text/plain')?.['value'] || '';
      const html = content.find((c) => c['type'] === 'text/html')?.['value'] || '';
      // SendGrid Inbound Parse delivers headers as a raw RFC 5322 string
      // ("Message-ID: <...>\r\nSubject: ...\r\n..."); v3 events deliver an
      // object. Normalize both into a lowercase-keyed map.
      const rawHeaders = mail['headers'];
      const headers: Record<string, string> = {};
      if (rawHeaders && typeof rawHeaders === 'object') {
        for (const [key, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
          headers[key.toLowerCase()] = String(value ?? '');
        }
      } else if (typeof rawHeaders === 'string') {
        for (const line of rawHeaders.split(/\r?\n/)) {
          const separator = line.indexOf(':');
          if (separator > 0) {
            headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
          }
        }
      }

      return {
        from: sender,
        recipient: to,
        subject,
        text: text || htmlToText(html),
        html,
        headers,
        messageId: headers['message-id']?.replace(/[<>]/g, '') || undefined,
        inReplyTo: headers['in-reply-to']?.replace(/[<>]/g, '') || null,
        references: headers['references']?.replace(/[<>]/g, '') || null,
        timestamp: mail['date'] as string | undefined,
      };
    }

    // Mailgun stored event
    if (data['recipient'] && data['subject']) {
      const body = payload as Record<string, unknown>;
      // message-headers arrives as a JSON string of [name, value] pairs;
      // In-Reply-To / References live there, not at the top level.
      const headers = parseHeaderPairs(body['message-headers']);
      return {
        recipient: String(body['recipient'] || ''),
        from: String(body['from'] || ''),
        subject: String(body['subject'] || ''),
        text: String(body['body-plain'] || body['stripped-text'] || ''),
        html: String(body['body-html'] || body['stripped-html'] || ''),
        headers,
        messageId:
          String(body['Message-Id'] || body['message-id'] || headers['message-id'] || '')
            .replace(/[<>]/g, '') || undefined,
        inReplyTo:
          String(body['In-Reply-To'] || headers['in-reply-to'] || '').replace(/[<>]/g, '') || null,
        references:
          String(body['References'] || headers['references'] || '').replace(/[<>]/g, '') || null,
        attachments: normalizeAttachments(body['attachments']),
        timestamp: String(body['timestamp'] || ''),
      };
    }

    // SES / SNS wrapped
    if (data['Type'] === 'Notification' && data['Message']) {
      const message = JSON.parse(String(data['Message'])) as Record<string, unknown>;
      const mail = message['mail'] as Record<string, unknown>;
      const headers = (mail['headers'] as Array<Record<string, string>>) || [];
      const headerMap: Record<string, string> = {};
      for (const h of headers) {
        headerMap[(h['name'] || '').toLowerCase()] = h['value'] || '';
      }
      const content = (mail['content'] as Array<Record<string, string>>) || [];
      const text = content.find((c) => c['type'] === 'text/plain')?.['value'] || '';
      const html = content.find((c) => c['type'] === 'text/html')?.['value'] || '';

      const destination = (mail['destination'] as string[] | undefined) || [];
      const commonHeaders = (mail['commonHeaders'] as Record<string, string> | undefined) || {};

      return {
        recipient: destination[0] || '',
        from: String(mail['source'] || ''),
        subject: commonHeaders['subject'] || '',
        text: text || htmlToText(html),
        html,
        headers: headerMap,
        messageId: headerMap['message-id']?.replace(/[<>]/g, '') || undefined,
        inReplyTo: headerMap['in-reply-to']?.replace(/[<>]/g, '') || null,
        references: headerMap['references']?.replace(/[<>]/g, '') || null,
        timestamp: String(mail['timestamp'] || ''),
      };
    }

    // Generic direct payload
    if (data['recipient'] || data['to'] || data['from']) {
      const body = payload as Record<string, unknown>;
      const rawHeaders = body['headers'];
      const headers: Record<string, string> = {};
      if (rawHeaders && typeof rawHeaders === 'object') {
        for (const [key, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
          headers[key.toLowerCase()] = String(value ?? '');
        }
      } else if (typeof rawHeaders === 'string') {
        for (const line of rawHeaders.split(/\r?\n/)) {
          const separator = line.indexOf(':');
          if (separator > 0) {
            headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
          }
        }
      }
      return {
        recipient: String(body['recipient'] || body['to'] || ''),
        from: String(body['from'] || ''),
        subject: String(body['subject'] || ''),
        text: String(body['text'] || body['body'] || ''),
        html: String(body['html'] || ''),
        headers,
        attachments:
          normalizeAttachments(body['attachments']) ||
          normalizeSendGridInboundAttachments(body) ||
          undefined,
        messageId: headers['message-id']?.replace(/[<>]/g, '') || undefined,
        inReplyTo: headers['in-reply-to']?.replace(/[<>]/g, '') || null,
        references: headers['references']?.replace(/[<>]/g, '') || null,
        timestamp: String(body['timestamp'] || body['date'] || ''),
      };
    }

    return null;
  }

  async getHealth(): Promise<EmailHealthInfo> {
    let smtpConnected = false;
    if (this.transporter) {
      try {
        await this.transporter.verify();
        smtpConnected = true;
      } catch {
        smtpConnected = false;
      }
    }

    return {
      configured: this.configured,
      provider: process.env.EMAIL_SERVICE || 'smtp',
      smtpConnected,
      from: EMAIL_FROM_ADDRESS,
    };
  }
}

export default new EmailService();
