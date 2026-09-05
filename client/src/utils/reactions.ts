// Reaction helpers shared by every surface that shows or toggles emoji
// reactions (message rows, notification rows, announcement cards, task
// details).
//
// A reaction row comes from the server as a flat object:
//   { id, <target>_id, user_id, reaction, first_name, last_name, … }
// The <target>_id key depends on the domain (message_id / announcement_id /
// task_id), so the helpers here only rely on `user_id`, `reaction` and the
// reactor name columns.
import type { Reaction, Notification } from '../models';

/** What a notification points at when that target can carry reactions. */
export type ReactionTarget =
  | { kind: 'message'; conversationId: number; messageId: number }
  | { kind: 'announcement'; announcementId: number }
  | { kind: 'task'; taskId: number };

const parseData = (raw: unknown): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    return typeof raw === 'string'
      ? (JSON.parse(raw) as Record<string, unknown>)
      : (raw as Record<string, unknown>);
  } catch {
    return null;
  }
};

const positiveId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
};

/**
 * The reactable target a notification points at, or null when the row has no
 * reaction model (missed calls, meeting reminders, …) or its ids are missing.
 *
 *   mention / new_message → a message (conversationId + messageId)
 *   announcement          → an announcement (announcementId)
 *   task_assigned / task_deadline → a task (taskId)
 */
export const reactableTargetOf = (notification: Notification): ReactionTarget | null => {
  const data = parseData(notification.data);
  if (!data) return null;
  if (notification.type === 'mention' || notification.type === 'new_message') {
    const conversationId = positiveId(data.conversationId);
    const messageId = positiveId(data.messageId);
    if (conversationId === null || messageId === null) return null;
    return { kind: 'message', conversationId, messageId };
  }
  if (notification.type === 'announcement') {
    const announcementId = positiveId(data.announcementId);
    if (announcementId === null) return null;
    return { kind: 'announcement', announcementId };
  }
  if (notification.type === 'task_assigned' || notification.type === 'task_deadline') {
    const taskId = positiveId(data.taskId);
    if (taskId === null) return null;
    return { kind: 'task', taskId };
  }
  return null;
};

/** Reactions already attached to a notification row (may be undefined). */
export const reactionsOf = (notification: Notification): Reaction[] =>
  notification.reactions || [];

/** "Maya Kim" for a reaction row — falls back to a stable placeholder. */
export const reactorName = (reaction: Reaction): string =>
  [reaction.first_name, reaction.last_name]
    .filter((part): part is string => !!part && part.trim() !== '')
    .join(' ')
    .trim() || `User ${reaction.user_id}`;

/** One grouped chip: the emoji, its count, whether I reacted, and who did. */
export interface ReactionGroup {
  emoji: string;
  count: number;
  mine: boolean;
  names: string[];
  userIds: number[];
}

/**
 * Group raw reaction rows by emoji (order of first appearance), with the
 * count, the current user's own participation and the reactor display names
 * for tooltips. Row order comes from the server (created_at ASC), so the
 * chips stay stable across renders.
 */
export const groupReactions = (
  reactions: Reaction[] = [],
  currentUserId: number | null,
): ReactionGroup[] => {
  const grouped = new Map<
    string,
    { count: number; mine: boolean; names: string[]; userIds: number[] }
  >();
  for (const reaction of reactions) {
    const entry = grouped.get(reaction.reaction) || {
      count: 0,
      mine: false,
      names: [],
      userIds: [],
    };
    entry.count += 1;
    const userId = Number(reaction.user_id);
    if (currentUserId !== null && userId === Number(currentUserId)) {
      entry.mine = true;
    }
    if (!entry.userIds.includes(userId)) {
      entry.userIds.push(userId);
      entry.names.push(reactorName(reaction));
    }
    grouped.set(reaction.reaction, entry);
  }
  return Array.from(grouped.entries()).map(([emoji, meta]) => ({
    emoji,
    ...meta,
  }));
};

/** Human summary for a chip tooltip, e.g. "Maya Kim, Dara Sok reacted". */
export const reactionSummary = (group: ReactionGroup): string => {
  if (group.names.length === 0) return 'Someone reacted';
  const label = group.names.join(', ');
  return `${label} reacted`;
};
