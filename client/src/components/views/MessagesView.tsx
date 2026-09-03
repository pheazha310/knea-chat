import React from 'react';
import Avatar from '../common/Avatar';
import Icon from '../common/Icon';
import type { ChatMessage, Conversation, User } from '../../models';

interface MessagesViewProps {
  conversations: Conversation[];
  people: User[];
  currentUserId: number | null;
  messages: Record<number, ChatMessage[]>;
  unreadMap: Record<string, number>;
  /** Unread counts by conversation id (covers group chats too). */
  convUnreadMap: Record<number, number>;
  onOpenConversation: (id: number) => void;
  onOpenDirect: (user: User) => void;
  onCreateChat: () => void;
}

/** The other participant's name for a direct conversation. */
const otherName = (conv: Conversation, currentUserId: number | null) => {
  // Team/channel conversations are shared rooms — the name, not a person's.
  if (conv.type === 'team') return conv.name || 'Team';
  if (conv.type === 'channel') return conv.name || 'Channel';
  const other = conv.members?.find((m) => m.id !== currentUserId);
  if (other) return `${other.first_name} ${other.last_name}`.trim();
  return conv.name;
};

const MessagesView = ({
  conversations = [],
  people = [],
  currentUserId,
  messages = {},
  unreadMap = {},
  convUnreadMap = {},
  onOpenConversation,
  onOpenDirect,
  onCreateChat,
}: MessagesViewProps) => {
  const recent = conversations.filter(
    (c) =>
      c.type === 'direct' ||
      c.type === 'group' ||
      c.type === 'team' ||
      c.type === 'channel',
  );

  const previewOf = (conv: Conversation) => {
    // Prefer the live cache when this conversation was opened this session.
    const list = messages[conv.id];
    if (list && list.length > 0) return list[list.length - 1].content;
    // After a page refresh the cache only holds the restored conversation, so
    // fall back to the server-side last-message preview (it survives reloads).
    return conv.last_message_content || 'No messages yet';
  };

  return (
    <div className="view-page">
      <div className="view-header">
        <div>
          <h1>Messages</h1>
          <p>Direct messages and group conversations.</p>
        </div>
        <button className="btn-primary" onClick={onCreateChat}>
          <Icon name="plus" size={14} /> New chat
        </button>
      </div>

      {recent.length > 0 && (
        <section className="mb-5">
          <h4 className="search-section-title">RECENT CONVERSATIONS</h4>
          <div className="list-card">
            {recent.map((conv) => {
              const other = conv.members?.find((m) => m.id !== currentUserId);
              const unread =
                convUnreadMap[conv.id] ||
                (other ? unreadMap[`user:${other.id}`] || 0 : 0);
              const name = otherName(conv, currentUserId);
              return (
                <button key={conv.id} className="list-row" onClick={() => onOpenConversation(conv.id)}>
                  {conv.type === 'team' || conv.type === 'channel' ? (
                    <span className="team-row-icon">
                      <Icon
                        name={conv.type === 'team' ? 'grid' : 'hash'}
                        size={13}
                      />
                    </span>
                  ) : (
                    <Avatar person={other} className="small" />
                  )}
                  <span className="list-row-main">
                    <b>
                      {conv.type === 'group' && <em className="group-tag">Group</em>}
                      {conv.type === 'team' && <em className="group-tag">Team</em>}
                      {conv.type === 'channel' && <em className="group-tag">Channel</em>}
                      {name}
                    </b>
                    <small className="list-row-preview">{previewOf(conv)}</small>
                  </span>
                  {unread > 0 && <span className="unread-dot">{unread}</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h4 className="search-section-title">PEOPLE</h4>
        <div className="list-card">
          {people.length === 0 && (
            <div className="list-empty">No colleagues yet — invite someone!</div>
          )}
          {people.map((person) => {
            const name = `${person.first_name} ${person.last_name}`;
            const unread = unreadMap[`user:${person.id}`] || 0;
            return (
              <button key={person.id} className="list-row" onClick={() => onOpenDirect(person)}>
                <Avatar person={person} className="small" showStatus />
                <span className="list-row-main">
                  <b>{name}</b>
                  <small>{person.job_title || person.email}</small>
                </span>
                {person.status === 'online' && <span className="online-chip">Online</span>}
                {unread > 0 && <span className="unread-dot">{unread}</span>}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default MessagesView;
