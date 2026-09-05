// NotificationMessageModal — full-message view opened from a message
// notification (mention / new_message).
//
// The server only stores a 120-char preview on the notification row, so this
// fetches the real message by id (`GET /api/messages/:id`) and shows it in
// full: sender, complete content, attachments and current reactions. The
// footer reuses the same React / Reply affordances as the notification rows,
// plus an "Open in conversation" button that jumps into the chat.
import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import Avatar from '../common/Avatar';
import Icon from '../common/Icon';
import type { IconName } from '../common/Icon';
import NotificationReactionAction from '../common/NotificationReactionAction';
import NotificationReplyAction from '../common/NotificationReplyAction';
import { MessageModel, resolveFileUrl } from '../../models/Message';
import type { Message, Notification } from '../../models';
import { messageTargetOf } from '../../utils/notificationReply';
import type {
  ReplyMessageHandler,
  ReplyMissedCallHandler,
} from '../../utils/notificationReply';

interface NotificationMessageModalProps {
  notification: Notification;
  onClose: () => void;
  /** Open the conversation and try to land on this message. */
  onOpenInChat: (conversationId: number, messageId: number) => void;
  onReplyMessage?: ReplyMessageHandler;
  onReplyMissedCall?: ReplyMissedCallHandler;
  /** Fired after replying / reacting inside the modal (acknowledge). */
  onAcknowledged?: (notification: Notification) => void;
}

const fullTime = (value?: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const senderName = (message: Message): string =>
  [message.first_name, message.last_name].filter(Boolean).join(' ').trim();

const conversationIcon = (type?: string): IconName => {
  if (type === 'channel') return 'hash';
  if (type === 'team') return 'users';
  if (type === 'direct') return 'user';
  return 'message';
};

const conversationLabel = (conversation: {
  type: string;
  name: string | null;
} | null): string => {
  if (!conversation) return 'Conversation';
  if (conversation.type === 'channel') return `#${conversation.name || ''}`;
  if (conversation.type === 'team')
    return conversation.name ? `Team · ${conversation.name}` : 'Team conversation';
  if (conversation.type === 'direct') return 'Direct message';
  return conversation.name || 'Conversation';
};

const formatFileSize = (bytes?: number | null): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const NotificationMessageModal = ({
  notification,
  onClose,
  onOpenInChat,
  onReplyMessage,
  onReplyMissedCall,
  onAcknowledged,
}: NotificationMessageModalProps) => {
  // Compute the target once on mount. `messageTargetOf` returns a fresh object
  // each call, so deriving it on every render made the effect dependency below
  // change every render — re-fetching in a loop and flickering the modal
  // between "Loading message…" and the content (the "jumping and shaking").
  // The modal is opened per-notification and unmounts on close, so the target
  // never needs to change while it is open.
  const [target] = useState(() => messageTargetOf(notification));
  const [message, setMessage] = useState<Message | null>(null);
  const [conversation, setConversation] = useState<{
    id: number;
    type: string;
    name: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!target) return;
    let mounted = true;
    setLoading(true);
    setError(false);
    MessageModel.getById(target.messageId)
      .then((res) => {
        if (!mounted) return;
        setMessage(res.data.data.message);
        setConversation(res.data.data.conversation);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [target]);

  const openInChat = () => {
    if (!target) return;
    onOpenInChat(target.conversationId, target.messageId);
  };

  // Available even when the message can no longer be fetched, so the user can
  // still reach the conversation it was sent in.
  const openButton = target ? (
    <button type="button" className="msgmodal-open" onClick={openInChat}>
      <Icon name="arrow-right" size={13} />
      Open in conversation
    </button>
  ) : null;

  return (
    <Modal title="Message" onClose={onClose} width={560}>
      <div className="msgmodal">
        <div className="msgmodal-context">
          <Icon name={conversationIcon(conversation?.type)} size={13} />
          <span>{conversationLabel(conversation)}</span>
          {message && <time>{fullTime(message.created_at)}</time>}
        </div>

        {loading && (
          <div className="msgmodal-state msgmodal-loading" role="status">
            <div className="loading-spinner small" aria-hidden="true" />
            <span className="loading-text">Loading message…</span>
          </div>
        )}

        {error && !message && (
          <div className="msgmodal-state">
            <Icon name="alert" size={18} />
            <b>This message is no longer available</b>
            <p>
              It may have been deleted, or you no longer have access to the
              conversation it was sent in.
            </p>
            {openButton}
          </div>
        )}

        {message && (
          <>
            <div className="msgmodal-sender">
              <Avatar
                person={{
                  id: message.sender_id,
                  first_name: message.first_name,
                  last_name: message.last_name,
                  profile_picture: message.profile_picture,
                }}
                className="small"
              />
              <span>
                <b>{senderName(message) || 'Someone'}</b>
                <small>
                  {message.type === 'voice'
                    ? 'Voice message'
                    : message.type === 'file'
                      ? 'File'
                      : message.type === 'image'
                        ? 'Image'
                        : message.forwarded_from
                          ? 'Forwarded'
                          : 'Message'}
                </small>
              </span>
            </div>

            {message.content && (
              <p className="msgmodal-content">{message.content}</p>
            )}

            {message.attachments && message.attachments.length > 0 && (
              <ul className="msgmodal-files">
                {message.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <a
                      href={resolveFileUrl(attachment.file_url)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon name="file" size={14} />
                      <span>
                        <b>{attachment.file_name}</b>
                        {attachment.file_size ? (
                          <small>{formatFileSize(attachment.file_size)}</small>
                        ) : null}
                      </span>
                      <Icon name="external" size={12} className="msgmodal-file-open" />
                    </a>
                  </li>
                ))}
              </ul>
            )}

            <div className="msgmodal-actions">
              <NotificationReactionAction
                notification={notification}
                onAcknowledged={onAcknowledged}
              />
              <NotificationReplyAction
                notification={notification}
                onReplyMessage={onReplyMessage}
                onReplyMissedCall={onReplyMissedCall}
                onSent={onAcknowledged}
              />
              {openButton}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default NotificationMessageModal;
