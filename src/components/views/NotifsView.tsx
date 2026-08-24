import React from 'react';
import Icon from '../common/Icon';
import type { IconName } from '../common/Icon';
import NotificationReplyAction from '../common/NotificationReplyAction';
import type { Notification } from '../../models';
import { replyTargetOf } from '../../utils/notificationReply';

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
};

const NotifsView = ({
  notifications = [],
  unreadCount = 0,
  onMarkRead,
  onMarkAllRead,
  onReplyMissedCall,
  onReplyMessage,
}: NotifsViewProps) => {
  return (
    <div className="view-page">
      <div className="view-header">
        <div>
          <h1>Notifications</h1>
          <p>{unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up 🎉"}</p>
        </div>
        {unreadCount > 0 && (
          <button className="btn-secondary" onClick={onMarkAllRead}>
            Mark all read
          </button>
        )}
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
            return (
              <li key={n.id} className={unread ? 'unread' : ''}>
                <span className="notif-icon"><Icon name={ICONS[n.type] || 'bell'} size={15} /></span>
                <span className="notif-body">
                  <b>{n.title}</b>
                  {n.message && <p>{n.message}</p>}
                  <time>{relativeTime(n.created_at)}</time>
                </span>
                {replyable ? (
                  <NotificationReplyAction
                    notification={n}
                    onReplyMissedCall={onReplyMissedCall}
                    onReplyMessage={onReplyMessage}
                    onSent={(item) => {
                      if (!item.is_read) onMarkRead(item.id);
                    }}
                  />
                ) : (
                  unread && (
                    <button
                      className="notif-read"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkRead(n.id);
                      }}
                    >
                      Mark read
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default NotifsView;
