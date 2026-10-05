import React, { useState } from 'react';
import Avatar from '../../../shared/ui/Avatar';
import Icon from '../../../shared/ui/Icon';
import type { Channel, Team, User } from '../../../entities';

interface ConversationListProps {
  channels: Channel[];
  teams: Team[];
  people: User[];
  selectedKey: string | null;
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
  const [channelsOpen, setChannelsOpen] = useState(true);
  const [teamsOpen, setTeamsOpen] = useState(true);
  const [dmsOpen, setDmsOpen] = useState(true);

  const filteredChannels = channels
    .filter((channel) => channel.name?.toLowerCase().includes(filterText))
    .sort((a, b) => a.name.localeCompare(b.name));
  const filteredTeams = teams
    .filter((team) =>
      `${team.name} ${team.description || ''}`.toLowerCase().includes(filterText),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
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
  const canCreateChannel = canManage || teams.some((t) => t.user_role);
  const canAccessTeam = (team: Team) => !!team.user_role || canManage;

  return (
    <div className="conversation-list">
      <section className="side-section">
        <div
          className="section-header section-header--clickable"
          onClick={() => setChannelsOpen((o) => !o)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setChannelsOpen((o) => !o);
            }
          }}
        >
          <span className="section-label">Channels</span>
          <span className="section-header-buttons">
            {canCreateChannel && (
              <button
                className="section-action"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateChannel();
                }}
                aria-label="Add channel"
              >
                <Icon name="plus" size={14} />
              </button>
            )}
            <span className={`section-chevron ${channelsOpen ? 'open' : ''}`}>
              <Icon name="chevron-down" size={12} />
            </span>
          </span>
        </div>
        <div className={`section-body ${channelsOpen ? 'open' : ''}`}>
          <div className="section-body-inner">
            {filteredChannels.length === 0 && filterText && (
              <div className="list-empty">No channels match &ldquo;{filterText}&rdquo;</div>
            )}
            {filteredChannels.map((channel) => {
              const unread = unreadMap[`channel:${channel.id}`] || 0;
              return (
                <button
                  key={channel.id}
                  onClick={() => onSelectChannel(channel)}
                  className={`list-row ${unread > 0 ? 'has-unread' : ''} ${
                    selectedKey === `channel:${channel.id}` ? 'selected' : ''
                  }`}
                  title={channel.description || channel.name}
                  aria-current={
                    selectedKey === `channel:${channel.id}` ? 'true' : undefined
                  }
                >
                  <span className="row-icon">
                    <Icon name="hash" size={15} />
                  </span>
                  <span className="row-name">{channel.name}</span>
                  <span className="row-meta">
                    {unread > 0 && <span className="unread-badge">{unread}</span>}
                    {channel.member_count != null && (
                      <span className="count-badge">{channel.member_count}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
      <section className="side-section">
        <div
          className="section-header section-header--clickable"
          onClick={() => setTeamsOpen((o) => !o)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setTeamsOpen((o) => !o);
            }
          }}
        >
          <span className="section-label">Teams</span>
          <span className="section-header-buttons">
            {canManage && (
              <button
                className="section-action"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateTeam();
                }}
                aria-label="Add team"
              >
                <Icon name="plus" size={14} />
              </button>
            )}
            <span className={`section-chevron ${teamsOpen ? 'open' : ''}`}>
              <Icon name="chevron-down" size={12} />
            </span>
          </span>
        </div>
        <div className={`section-body ${teamsOpen ? 'open' : ''}`}>
          <div className="section-body-inner">
            {filteredTeams.length === 0 && filterText && (
              <div className="list-empty">No teams match &ldquo;{filterText}&rdquo;</div>
            )}
            {filteredTeams.map((team) => {
              const accessible = canAccessTeam(team);
              const unread = unreadMap[`team:${team.id}`] || 0;
              return (
                <button
                  key={team.id}
                  onClick={() => onSelectTeam(team)}
                  className={`list-row team-row ${unread > 0 ? 'has-unread' : ''} ${selectedKey === `team:${team.id}` ? 'selected' : ''}`}
                  title={
                    accessible
                      ? team.description || team.name
                      : 'Members only — join this team to message it'
                  }
                  aria-current={
                    selectedKey === `team:${team.id}` ? 'true' : undefined
                  }
                >
                  <span className="row-icon">
                    <Icon name="grid" size={15} />
                  </span>
                  <span className="row-name">{team.name}</span>
                  <span className="row-meta">
                    {unread > 0 && <span className="unread-badge">{unread}</span>}
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
          </div>
        </div>
      </section>
      <section className="side-section direct-section">
        <div
          className="section-header section-header--clickable"
          onClick={() => setDmsOpen((o) => !o)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setDmsOpen((o) => !o);
            }
          }}
        >
          <span className="section-label">Direct Messages</span>
          <span className="section-header-buttons">
            <button
              className="section-action"
              onClick={(e) => {
                e.stopPropagation();
                onCreateChat();
              }}
              aria-label="New chat"
            >
              <Icon name="plus" size={14} />
            </button>
            <span className={`section-chevron ${dmsOpen ? 'open' : ''}`}>
              <Icon name="chevron-down" size={12} />
            </span>
          </span>
        </div>
        <div className={`section-body ${dmsOpen ? 'open' : ''}`}>
          <div className="section-body-inner">
            {filteredPeople.length === 0 && filterText && (
              <div className="list-empty">No people match &ldquo;{filterText}&rdquo;</div>
            )}
            {filteredPeople.map((person) => {
              const name = `${person.first_name} ${person.last_name}`;
              const unread = unreadMap[`user:${person.id}`] || 0;
              return (
                <button
                  key={person.id}
                  onClick={() => onSelectPerson(person)}
                  className={`list-row person-row ${unread > 0 ? 'has-unread' : ''} ${
                    selectedKey === `user:${person.id}` ? 'selected' : ''
                  }`}
                  title={person.email}
                  aria-current={
                    selectedKey === `user:${person.id}` ? 'true' : undefined
                  }
                >
                  <Avatar person={person} className="small" showStatus />
                  <span className="row-name">{name}</span>
                  <span className="row-meta">
                    {unread > 0 && <span className="unread-badge">{unread}</span>}
                    {person.job_title && (
                      <span className="job-title">{person.job_title}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
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
