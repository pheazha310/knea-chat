// NotificationReplyAction — the Reply affordance for a single notification row.
// Shared by the Notifications view and the bell popover (Dashboard) so the
// behavior stays identical: toggle → inline input → send (DM for missed calls,
// into the conversation — threaded to the message — for mentions / new messages).
import React, { useState } from 'react';
import Icon from './Icon';
import type { Notification } from '../../models';
import {
  replyAriaLabelOf,
  replyPlaceholderOf,
  replyTargetOf,
  type ReplyMessageHandler,
  type ReplyMissedCallHandler,
} from '../../utils/notificationReply';

interface NotificationReplyActionProps {
  notification: Notification;
  onReplyMissedCall?: ReplyMissedCallHandler;
  onReplyMessage?: ReplyMessageHandler;
  /** Called after a reply is sent successfully (e.g. mark the notification read). */
  onSent?: (notification: Notification) => void;
}

const NotificationReplyAction = ({
  notification,
  onReplyMissedCall,
  onReplyMessage,
  onSent,
}: NotificationReplyActionProps) => {
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const target = replyTargetOf(notification, onReplyMissedCall, onReplyMessage);
  if (target === null) return null;

  const toggleReply = () => {
    setReplying((open) => !open);
    setReplyText('');
    setReplyError(null);
  };

  const sendReply = async () => {
    const content = replyText.trim();
    if (!content || sending) return;
    setSending(true);
    setReplyError(null);
    const ok =
      target.kind === 'dm'
        ? (await onReplyMissedCall?.(target.userId, content)) ?? false
        : (await onReplyMessage?.(target.conversationId, content, target.messageId)) ?? false;
    setSending(false);
    if (!ok) {
      setReplyError('Could not send the reply — try again.');
      return;
    }
    setReplyText('');
    setReplying(false);
    setSent(true);
    onSent?.(notification);
    window.setTimeout(() => setSent(false), 2500);
  };

  return (
    <>
      <button
        type="button"
        className={`notif-reply-toggle ${replying ? 'active' : ''}`}
        onClick={toggleReply}
        aria-label={replying ? 'Cancel reply' : replyAriaLabelOf(target)}
      >
        <Icon name="message" size={12} />
        {replying ? 'Cancel' : 'Reply'}
      </button>
      {replying && (
        <div className="notif-reply">
          <input
            autoFocus
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void sendReply();
              } else if (e.key === 'Escape') {
                toggleReply();
              }
            }}
            placeholder={replyPlaceholderOf(target)}
            disabled={sending}
            aria-label={replyAriaLabelOf(target)}
          />
          <button
            type="button"
            className="notif-reply-send"
            onClick={() => void sendReply()}
            disabled={!replyText.trim() || sending}
            aria-label="Send reply"
          >
            ➤
          </button>
          {replyError && <span className="notif-reply-error">{replyError}</span>}
        </div>
      )}
      {sent && (
        <span className="notif-reply-sent">
          <Icon name="check" size={12} /> Sent
        </span>
      )}
    </>
  );
};

export default NotificationReplyAction;
