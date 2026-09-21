/**
 * Email-specific types for the omni-channel email adapter.
 */

export type EmailProvider = 'smtp' | 'sendgrid' | 'mailgun' | 'ses';

export interface EmailAddress {
  name?: string | null;
  address: string;
}

export interface EmailSendOptions {
  from: EmailAddress;
  to: EmailAddress | EmailAddress[];
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
  replyTo?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  /**
   * Structured email threading (RFC 5322): the adapter derives these from the
   * inbound message so replies thread correctly in the customer's mail
   * client. `subject` is the original subject (a `Re:` prefix is added when
   * missing); `inReplyTo` is the parent Message-ID; `references` are the
   * ancestor Message-IDs (oldest first).
   */
  threading?: {
    subject?: string | null;
    inReplyTo?: string | null;
    references?: string[] | null;
  } | null;
}

export interface EmailSendResult {
  ok: boolean;
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
  description?: string;
}

export interface EmailWebhookPayload {
  recipient?: string;
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    name: string;
    content_type: string;
    size?: number;
    url?: string;
  }>;
  messageId?: string;
  inReplyTo?: string | null;
  references?: string | null;
  timestamp?: string | number;
}

export interface EmailWebhookHeaders {
  provider?: string;
  signature?: string;
  timestamp?: string;
  token?: string;
  'x-twilio-email-event-webhook-signature'?: string;
  'x-twilio-email-event-webhook-timestamp'?: string;
  'x-mailgun-signature'?: string;
  'x-mailgun-timestamp'?: string;
  'x-mailgun-token'?: string;
  'x-postmark-webhook-signature'?: string;
}

export interface EmailHealthInfo {
  configured: boolean;
  provider: string;
  smtpConnected?: boolean;
  from: string | null;
}
