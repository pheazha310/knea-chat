// NotificationReactionAction — the emoji-reaction affordance for a single
// notification row. Shared by the Notifications view and the bell popover
// (Dashboard) so the behavior stays identical.
//
// A notification is reactable when its target has a reaction model:
//   mention / new_message → the real message (everyone in the chat sees it)
//   announcement          → the announcement (its audience sees it)
//   task_assigned / task_deadline → the task (assignee/team/managers see it)
// Picking an emoji toggles the reaction on that target; tapping the same
// emoji again removes it. A successful reaction also acknowledges the
// notification (the view marks it read via onAcknowledged).
//
// The row also shows the target's existing reaction chips (counts + reactor
// names), so you can see and join in without opening the picker.
import React, { useCallback } from 'react';
import ReactionBar, { type ReactionToggleHandler } from './ReactionBar';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';
import type { Notification } from '../../models';
import { toggleTargetReaction } from '../../utils/toggleTargetReaction';
import {
  reactableTargetOf,
  reactionsOf,
} from '../../utils/reactions';

interface NotificationReactionActionProps {
  notification: Notification;
  /** Called after a reaction was applied (e.g. mark the notification read). */
  onAcknowledged?: (notification: Notification) => void;
}

/** The a11y trigger label for each target kind. */
const triggerLabelOf = (notification: Notification): string => {
  if (notification.type === 'announcement') {
    return 'React to the announcement';
  }
  if (notification.type === 'task_assigned' || notification.type === 'task_deadline') {
    return 'React to the task';
  }
  return 'React to the message';
};

const NotificationReactionAction = ({
  notification,
  onAcknowledged,
}: NotificationReactionActionProps) => {
  const target = reactableTargetOf(notification);
  const meId = useAuthStore((s) => s.user?.id ?? null);

  const onToggle = useCallback<ReactionToggleHandler>(
    async (emoji, mine) => {
      if (target === null) return null;
      const fresh = await toggleTargetReaction(target, emoji, mine);
      if (fresh !== null) {
        useNotificationStore
          .getState()
          .setNotificationReactions(notification.id, fresh);
      }
      return fresh;
    },
    [target, notification.id],
  );

  if (target === null) return null;

  return (
    <div className="notif-react">
      <ReactionBar
        reactions={reactionsOf(notification)}
        meId={meId}
        onToggle={onToggle}
        label={triggerLabelOf(notification)}
        onChanged={() => onAcknowledged?.(notification)}
      />
    </div>
  );
};

export default NotificationReactionAction;
