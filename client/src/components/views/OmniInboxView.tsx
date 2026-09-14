import React, { useState } from 'react';
import Avatar from '../common/Avatar';
import Icon from '../common/Icon';
import type { ChatMessage, Conversation, User } from '../../models';
import type { IconName } from '../common/Icon';

interface OmniInboxViewProps {
  conversations: Conversation[];
  currentUserId: number | null;
  messages: Record<number, ChatMessage[]>;
  unreadMap: Record<number, number>;
  onOpenConversation: (id: number) => void;
  onAssignConversation: (id: number, agentId?: number) => void;
  onUnassignConversation: (id: number) => void;
}

const channelIcon = (channel: string): IconName => {
  switch (channel.toLowerCase()) {
    case 'telegram':
      return 'message';
    case 'website':
      return 'external';
    default:
      return 'message';
  }
};

const OmniInboxView = ({
  conversations = [],
  currentUserId,
  messages = {},
  unreadMap = {},
  onOpenConversation,
  onAssignConversation,
  onUnassignConversation,
}: OmniInboxViewProps) => {
  const [hideFailing, setHideFailing] = useState(false);

  const allExternal = conversations.filter((c) => !!c.channel);
  const isFailing = (conv: Conversation): boolean =>
    Number(conv.delivery_fail_count ?? 0) > 0;
  const failingCount = allExternal.filter(isFailing).length;
  const external = hideFailing ? allExternal.filter((c) => !isFailing(c)) : allExternal;

  const previewOf = (conv: Conversation) => {
    const list = messages[conv.id];
    if (list && list.length > 0) return list[list.length - 1].content;
    return conv.last_message_content || 'No messages yet';
  };

  return (
    <div className="view-page">
      <div className="view-header">
        <div>
          <h1>Omni Inbox</h1>
          <p>External conversations from all channels.</p>
        </div>
        {failingCount > 0 && (
          <button
            className={`delivery-toggle${hideFailing ? ' active' : ''}`}
            onClick={() => setHideFailing((v) => !v)}
            title={
              hideFailing
                ? 'Show conversations with delivery problems'
                : 'Hide conversations with delivery problems'
            }
          >
            <Icon name="alert" size={13} />
            {failingCount} delivery issue{failingCount > 1 ? 's' : ''}
            {hideFailing ? ' · hidden' : ''}
          </button>
        )}
      </div>

      {external.length > 0 ? (
        <div className="list-card">
          {external.map((conv) => {
            const other = conv.members?.find((m) => m.id !== currentUserId);
            const unread = unreadMap[conv.id] || 0;
            const failing = isFailing(conv);
            const errorTitle = failing
              ? `Delivery failing (${conv.delivery_fail_count} consecutive): ${conv.last_delivery_error || 'unknown error'}`
              : undefined;
            return (
              <div
                key={conv.id}
                className={`list-row${failing ? ' delivery-failing' : ''}`}
                role="button"
                tabIndex={0}
                title={errorTitle}
                onClick={() => onOpenConversation(conv.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenConversation(conv.id);
                  }
                }}
              >
                <Avatar person={other} className="small" />
                <span className="list-row-main">
                  <b>
                    <em className="group-tag">
                      <Icon name={channelIcon(conv.channel || '')} size={12} />
                      {conv.channel}
                    </em>
                    {conv.name}
                    {failing && (
                      <em
                        className="group-tag delivery-warning-tag"
                        title={errorTitle}
                        aria-label={errorTitle}
                      >
                        <Icon name="alert" size={11} /> delivery failing
                      </em>
                    )}
                  </b>
                  <small className="list-row-preview">
                    {failing && conv.last_delivery_error
                      ? `⚠ ${conv.last_delivery_error}`
                      : previewOf(conv)}
                  </small>
                </span>
                {conv.assigned_agent_name ? (
                  <span className="row-meta">
                    <em className="group-tag assigned-tag">
                      Assigned: {conv.assigned_agent_name}
                    </em>
                    <button
                      className="icon-btn-unassign"
                      title="Unassign agent"
                      aria-label="Unassign agent"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnassignConversation(conv.id);
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ) : (
                  <button
                    className="claim-btn"
                    title="Claim this conversation"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssignConversation(conv.id);
                    }}
                  >
                    Claim
                  </button>
                )}
                {unread > 0 && <span className="unread-dot">{unread}</span>}
              </div>
            );
          })}
        </div>
      ) : hideFailing && failingCount > 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Icon name="alert" size={18} />
          </span>
          All conversations hidden — {failingCount} with delivery problems.
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Icon name="message" size={18} />
          </span>
          No external conversations yet.
        </div>
      )}
    </div>
  );
};

export default OmniInboxView;
