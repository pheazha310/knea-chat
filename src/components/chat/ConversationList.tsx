import React from 'react';
import Avatar from '../common/Avatar';
import Icon from '../common/Icon';
import type { Channel, Team, User } from '../../models';

interface ConversationListProps {
  channels: Channel[];
  teams: Team[];
  people: User[];
  /** Either `channel:<id>`, `user:<id>`, or `team:<id>` for the open item. */
  selectedKey: string | null;
  /** Unread counts keyed by `channel:<id>` / `user:<id>` for badge dots. */
  unreadMap?: Record<string, number>;
  canManage: boolean;
  filterText: string;
  onSelectChannel: (channel: Channel) => void;
  onSelectPerson: (person: User) => void;
  onSelectTeam: (team: Team) => void;
  onCreateChannel: () => void;
  onCreateChat: () => void;
  onCreateTeam: () => void;
}

const ConversationList = ({
  channels = [],
  teams = [],
  people = [],
  selectedKey = null,
  unreadMap = {},
  canManage = false,
  filterText,
  onSelectChannel,
  onSelectPerson,
  onSelectTeam,
  onCreateChannel,
  onCreateChat,
  onCreateTeam,
}: ConversationListProps) => {
  const filteredChannels = channels
    .filter((channel) => channel.name?.toLowerCase().includes(filterText))
    .sort((a, b) => a.name.localeCompare(b.name));
  const filteredTeams = teams
    .filter((team) =>
      `${team.name} ${team.description || ''}`.toLowerCase().includes(filterText),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  // Direct messages: online first, then alphabetical.
  const filteredPeople = people
    .filter((person) =>
      `${person.first_name} ${person.last_name} ${person.email}`
        .toLowerCase()
        .includes(filterText),
    )
    .sort((a, b) => {
      const aOnline = a.status === 'online' ? 0 : 1;
      const bOnline = b.status === 'online' ? 0 : 1;
      if (aOnline !== bOnline) return aOnline - bOnline;
      return `${a.first_name} ${a.last_name}`.localeCompare(
        `${b.first_name} ${b.last_name}`,
      );
    });
  // Channel creation: managers+ always; employees only if they belong to at
  // least one team (they can create channels inside their own teams).
  const canCreateChannel = canManage || teams.some((t) => t.user_role);
  // Team conversations are restricted to team members + managers/admins.
  const canAccessTeam = (team: Team) => !!team.user_role || canManage;

  return (
    <div className="conversation-list">
      <section className="side-section">
        <div className="section-header">
          <span className="section-label">Channels</span>
          {canCreateChannel && (
            <button className="section-action" onClick={onCreateChannel} aria-label="Add channel">
              <Icon name="plus" size={14} />
            </button>
          )}
        </div>
        {filteredChannels.length === 0 && filterText && (
          <div className="list-empty">No channels match “{filterText}”</div>
        )}
        {filteredChannels.map((channel) => (
          <button
            key={channel.id}
            onClick={() => onSelectChannel(channel)}
            className={`list-row ${
              selectedKey === `channel:${channel.id}` ? 'selected' : ''
            }`}
            title={channel.description || channel.name}
          >
            <span className="row-icon">
              <Icon name="hash" size={15} />
            </span>
            <span className="row-name">{channel.name}</span>
            <span className="row-meta">
              {unreadMap[`channel:${channel.id}`] > 0 && (
                <span className="unread-badge">{unreadMap[`channel:${channel.id}`]}</span>
              )}
              {channel.member_count != null && (
                <span className="count-badge">{channel.member_count}</span>
              )}
            </span>
          </button>
        ))}
      </section>
      <section className="side-section">
        <div className="section-header">
          <span className="section-label">Teams</span>
          {canManage && (
            <button className="section-action" onClick={onCreateTeam} aria-label="Add team">
              <Icon name="plus" size={14} />
            </button>
          )}
        </div>
        {filteredTeams.length === 0 && filterText && (
          <div className="list-empty">No teams match “{filterText}”</div>
        )}
        {filteredTeams.map((team) => {
          const accessible = canAccessTeam(team);
          return (
            <button
              key={team.id}
              onClick={() => onSelectTeam(team)}
              className={`list-row team-row ${selectedKey === `team:${team.id}` ? 'selected' : ''}`}
              title={
                accessible
                  ? team.description || team.name
                  : 'Members only — join this team to message it'
              }
            >
              <span className="row-icon">
                <Icon name="grid" size={15} />
              </span>
              <span className="row-name">{team.name}</span>
              <span className="row-meta">
                {unreadMap[`team:${team.id}`] > 0 && (
                  <span className="unread-badge">{unreadMap[`team:${team.id}`]}</span>
                )}
                {!accessible && (
                  <span className="row-icon lock-icon">
                    <Icon name="lock" size={12} />
                  </span>
                )}
                {team.member_count != null && (
                  <span className="count-badge">{team.member_count}</span>
                )}
              </span>
            </button>
          );
        })}
      </section>
      <section className="side-section direct-section">
        <div className="section-header">
          <span className="section-label">Direct Messages</span>
          <button className="section-action" onClick={onCreateChat} aria-label="New chat">
            <Icon name="plus" size={14} />
          </button>
        </div>
        {filteredPeople.length === 0 && filterText && (
          <div className="list-empty">No people match “{filterText}”</div>
        )}
        {filteredPeople.map((person) => {
          const name = `${person.first_name} ${person.last_name}`;
          return (
            <button
              key={person.id}
              onClick={() => onSelectPerson(person)}
              className={`list-row person-row ${
                selectedKey === `user:${person.id}` ? 'selected' : ''
              }`}
              title={person.email}
            >
              <Avatar person={person} className="small" showStatus />
              <span className="row-name">{name}</span>
              <span className="row-meta">
                {unreadMap[`user:${person.id}`] > 0 && (
                  <span className="unread-badge">{unreadMap[`user:${person.id}`]}</span>
                )}
                {person.job_title && (
                  <span className="job-title">{person.job_title}</span>
                )}
              </span>
            </button>
          );
        })}
      </section>
      <div className="sidebar-footer">
        <button className="new-chat-btn" onClick={onCreateChat}>
          <Icon name="plus" size={14} />
          New chat
        </button>
      </div>
    </div>
  );
};

export default ConversationList;
