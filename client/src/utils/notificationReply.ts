/**
 * Notification reply helpers — shared by the Notifications view and the bell
 * popover so both offer the same Reply affordance.
 *
 * Notification rows store `data` as JSON. Missed calls carry `callerUserId`
 * (reply = DM to the caller); mention / new_message rows carry `conversationId`
 * and `messageId` (reply = into that conversation, threaded when available).
 * The MySQL JSON column arrives as an object via the API, but older rows /
 * other shapes may arrive as a string — both are handled here.
 */
import type { Notification } from '../models';

/** Where a notification's reply should go. */
export type ReplyTarget =
  | { kind: 'dm'; userId: number }
  | { kind: 'conversation'; conversationId: number; messageId?: number };

export type ReplyMissedCallHandler = (userId: number, content: string) => Promise<boolean>;
export type ReplyMessageHandler = (
  conversationId: number,
  content: string,
  messageId?: number,
) => Promise<boolean>;

/** Parse a notification's JSON `data` field (may arrive as string or object). */
const parseData = (raw: unknown): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
  } catch {
    return null;
  }
};

/** Resolve the reply destination for a notification, or null when it has none
 *  (or the matching handler wasn't provided). */
export const replyTargetOf = (
  notification: Notification,
  onReplyMissedCall?: ReplyMissedCallHandler,
  onReplyMessage?: ReplyMessageHandler,
): ReplyTarget | null => {
  const data = parseData(notification.data);
  if (!data) return null;
  if (notification.type === 'missed_call' && onReplyMissedCall) {
    const id = Number(data.callerUserId);
    return Number.isFinite(id) && id > 0 ? { kind: 'dm', userId: id } : null;
  }
  if ((notification.type === 'mention' || notification.type === 'new_message') && onReplyMessage) {
    const id = Number(data.conversationId);
    if (!(Number.isFinite(id) && id > 0)) return null;
    const messageId = Number(data.messageId);
    return {
      kind: 'conversation',
      conversationId: id,
      messageId: Number.isFinite(messageId) && messageId > 0 ? messageId : undefined,
    };
  }
  return null;
};

export const replyPlaceholderOf = (target: ReplyTarget) =>
  target.kind === 'dm' ? 'Reply to the caller…' : 'Write a reply…';

export const replyAriaLabelOf = (target: ReplyTarget) =>
  target.kind === 'dm' ? 'Reply to the caller' : 'Reply to the message';

/**
 * The message a notification points at, when it is reactable. Only
 * `mention` / `new_message` rows carry `conversationId` + `messageId`, so
 * those are the notifications whose quick reactions land on the real message
 * (SRS FR-16). Returns null for anything else (missed calls, announcements,
 * tasks, …) or when the ids are missing/unparseable.
 */
export const messageTargetOf = (
  notification: Notification,
): { conversationId: number; messageId: number } | null => {
  if (notification.type !== 'mention' && notification.type !== 'new_message') {
    return null;
  }
  const data = parseData(notification.data);
  if (!data) return null;
  const conversationId = Number(data.conversationId);
  if (!(Number.isFinite(conversationId) && conversationId > 0)) return null;
  const messageId = Number(data.messageId);
  if (!(Number.isFinite(messageId) && messageId > 0)) return null;
  return { conversationId, messageId };
};
