import React from 'react';
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
  const external = conversations.filter((c) => !!c.channel);

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
      </div>

      {external.length > 0 ? (
        <div className="list-card">
          {external.map((conv) => {
            const other = conv.members?.find((m) => m.id !== currentUserId);
            const unread = unreadMap[conv.id] || 0;
            return (
              <div
                key={conv.id}
                className="list-row"
                role="button"
                tabIndex={0}
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
                  </b>
                  <small className="list-row-preview">{previewOf(conv)}</small>
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
