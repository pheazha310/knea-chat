import React, { useState } from 'react';
import Icon from '../common/Icon';
import type { IconName } from '../common/Icon';
import Modal from '../modals/Modal';
import NotificationReplyAction from '../common/NotificationReplyAction';
import NotificationReactionAction from '../common/NotificationReactionAction';
import { useNotificationPreferenceStore } from '../../store/notificationPreferenceStore';
import type { Notification } from '../../models';
import { replyTargetOf } from '../../utils/notificationReply';
import { reactableTargetOf } from '../../utils/reactions';

interface NotifsViewProps {
  notifications: Notification[];
  unreadCount: number;
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  /** Sends a direct reply to the caller from the missed-call notification. */
  onReplyMissedCall?: (userId: number, content: string) => Promise<boolean>;
  /** Posts a reply into the conversation from a mention / new-message notification. */
  onReplyMessage?: (
    conversationId: number,
    content: string,
    messageId?: number,
  ) => Promise<boolean>;
  /** Clicking a message notification opens its full message (marks it read). */
  onOpenMessageNotification?: (notification: Notification) => void;
}

const relativeTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const ICONS: Record<string, IconName> = {
  mention: 'user',
  new_message: 'message',
  announcement: 'bell',
  missed_call: 'phone',
  meeting_invite: 'calendar',
  meeting_reminder: 'calendar',
  task_assigned: 'check-circle',
  task_deadline: 'clock',
  message_reminder: 'clock',
};

const NotifsView = ({
  notifications = [],
  unreadCount = 0,
  onMarkRead,
  onMarkAllRead,
  onReplyMissedCall,
  onReplyMessage,
  onOpenMessageNotification,
}: NotifsViewProps) => {
  const [showPreferences, setShowPreferences] = useState(false);
  const {
    preferences,
    load: loadPreferences,
    setCategory: setPreference,
  } = useNotificationPreferenceStore();

  const openPreferences = () => {
    setShowPreferences(true);
    loadPreferences();
  };

  return (
    <div className="view-page">
      <div className="view-header">
        <div>
          <h1>Notifications</h1>
          <p>{unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up 🎉"}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={openPreferences}>
            <Icon name="gear" size={14} /> Preferences
          </button>
          {unreadCount > 0 && (
            <button className="btn-secondary" onClick={onMarkAllRead}>
              Mark all read
            </button>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="empty-conversation">
          <div className="empty-conversation-icon"><Icon name="bell" size={22} /></div>
          <b>No notifications yet</b>
          <p className="center">Mentions and new messages will show up here.</p>
        </div>
      ) : (
        <ul className="notif-list">
          {notifications.map((n) => {
            const unread = !n.is_read;
            const replyable = replyTargetOf(n, onReplyMissedCall, onReplyMessage) !== null;
            const reactableTarget = reactableTargetOf(n);
            const reactable = reactableTarget !== null;
            // Message notifications (mention / new_message) open a modal with
            // the full message content when clicked.
            const canOpenMessage =
              reactableTarget?.kind === 'message' && !!onOpenMessageNotification;
            return (
              <li
                key={n.id}
                className={`${unread ? 'unread' : ''} ${canOpenMessage ? 'clickable' : ''}`}
                role={canOpenMessage ? 'button' : undefined}
                tabIndex={canOpenMessage ? 0 : undefined}
                title={canOpenMessage ? 'View full message' : undefined}
                onClick={() => {
                  if (canOpenMessage) onOpenMessageNotification!(n);
                }}
                onKeyDown={
                  canOpenMessage
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenMessageNotification!(n);
                        }
                      }
                    : undefined
                }
              >
                <span className={`notif-icon ${unread ? 'unread' : ''}`}>
                  <Icon name={ICONS[n.type] || 'bell'} size={15} />
                </span>
                <span className="notif-body">
                  <b>{n.title}</b>
                  {n.message && <p>{n.message}</p>}
                  <time>{relativeTime(n.created_at)}</time>
                </span>
                <div
                  className="notif-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  {reactable && (
                    <NotificationReactionAction
                      notification={n}
                      onAcknowledged={(item) => {
                        if (!item.is_read) onMarkRead(item.id);
                      }}
                    />
                  )}
                  {replyable && (
                    <NotificationReplyAction
                      notification={n}
                      onReplyMissedCall={onReplyMissedCall}
                      onReplyMessage={onReplyMessage}
                      onSent={(item) => {
                        if (!item.is_read) onMarkRead(item.id);
                      }}
                    />
                  )}
                  {unread && !replyable && !reactable && (
                    <button
                      className="notif-read"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkRead(n.id);
                      }}
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showPreferences && (
        <Modal onClose={() => setShowPreferences(false)} title="Notification preferences" width={520}>
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Choose which kinds of notifications you want to receive. You can
              change these at any time — chats, mentions and meetings keep
              working, only the alerts stop.
            </p>
            {preferences.length === 0 ? (
              <div className="text-sm text-muted">Loading preferences…</div>
            ) : (
              <ul className="space-y-2">
                {preferences.map((pref) => (
                  <li key={pref.category}>
                    <button
                      type="button"
                      className="w-full flex items-start justify-between gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors border-gray-200 dark:border-gray-700 hover:border-lavender"
                      onClick={() => setPreference(pref.category, !pref.enabled)}
                      role="switch"
                      aria-checked={pref.enabled}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink">{pref.label}</span>
                        <span className="block text-xs text-muted mt-0.5">{pref.description}</span>
                      </span>
                      <span
                        className={`relative w-8 h-[18px] rounded-full transition-colors flex-shrink-0 mt-1 ${pref.enabled ? 'bg-lavender' : 'bg-gray-300 dark:bg-gray-600'}`}
                        aria-hidden="true"
                      >
                        <span
                          className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${pref.enabled ? 'translate-x-[14px]' : ''}`}
                        />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-muted flex items-center gap-1.5">
              <Icon name="info" size={12} />
              Turning off a category stops future alerts; existing notifications stay until read.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default NotifsView;
