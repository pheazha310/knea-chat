/**
 * Email channel input validation — pure functions, no I/O.
 *
 *   isValidEmailAddress()   one bare address (customer sender / recipient)
 *   validateEmailSendBody() req.body of POST /api/omni/email/send
 *
 * Controllers call these before any service work; the adapter re-checks the
 * recipient right before SMTP so a bad stored address fails as 'failed' with
 * a clear reason instead of an opaque provider error.
 */
import { MAX_REPLY_LENGTH } from '../../services/OmniChannel.service';

/**
 * Practical address check (not full RFC 5322): one `@`, a dotted domain, no
 * whitespace/brackets/quotes, RFC length limits. CR/LF are rejected outright
 * — they are how header-injection attacks smuggle extra headers.
 */
const ADDRESS_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:".]+(\.[^\s@<>()[\]\\,;:".]+)+$/;

export function isValidEmailAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/[\r\n]/.test(value)) return false;
  const address = value.trim();
  if (address.length === 0 || address.length > 254) return false;
  const local = address.slice(0, address.lastIndexOf('@'));
  if (local.length === 0 || local.length > 64) return false;
  return ADDRESS_PATTERN.test(address);
}

export interface EmailSendInput {
  conversationId: number;
  text: string;
  replyToMessageId: number | null;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> };

const isPositiveInteger = (value: unknown): boolean =>
  Number.isInteger(Number(value)) && Number(value) > 0;

/**
 * Validate `{ conversationId, text, replyToMessageId? }`. The recipient is
 * deliberately NOT accepted from the client — it is resolved server-side from
 * the conversation's stored contact, so an agent cannot email arbitrary
 * addresses through this endpoint.
 */
export function validateEmailSendBody(body: unknown): ValidationResult<EmailSendInput> {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};

  if (!isPositiveInteger(input.conversationId)) {
    errors.conversationId = 'conversationId must be a positive integer';
  }
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) {
    errors.text = 'text is required';
  } else if (text.length > MAX_REPLY_LENGTH) {
    errors.text = `text must be at most ${MAX_REPLY_LENGTH} characters`;
  }
  const hasReplyTo = input.replyToMessageId !== undefined && input.replyToMessageId !== null && input.replyToMessageId !== '';
  if (hasReplyTo && !isPositiveInteger(input.replyToMessageId)) {
    errors.replyToMessageId = 'replyToMessageId must be a positive integer';
  }
  if ('to' in input) {
    errors.to = 'The recipient is taken from the conversation and cannot be set by the client';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      conversationId: Number(input.conversationId),
      text,
      replyToMessageId: hasReplyTo ? Number(input.replyToMessageId) : null,
    },
  };
}
