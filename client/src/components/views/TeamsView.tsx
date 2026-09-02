import React from 'react';
import Icon from '../common/Icon';
import type { Channel, Team } from '../../models';

interface TeamsViewProps {
  teams: Team[];
  channels: Channel[];
  canManage: boolean;
  onSelectTeam: (team: Team) => void;
  onCreateTeam: () => void;
}

const TeamsView = ({
  teams = [],
  channels = [],
  canManage = false,
  onSelectTeam,
  onCreateTeam,
}: TeamsViewProps) => {
  const channelCount = (team: Team) =>
    channels.filter((c) => c.team_id === team.id).length;

  return (
    <div className="view-page">
      <div className="view-header">
        <div>
          <h1>Teams</h1>
          <p>Organize people by project or department.</p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={onCreateTeam}>
            <Icon name="plus" size={14} /> New team
          </button>
        )}
      </div>

      {teams.length === 0 ? (
        <div className="empty-conversation">
          <div className="empty-conversation-icon"><Icon name="grid" size={22} /></div>
          <b>No teams yet</b>
          <p className="center">Create a team to organize your workspace.</p>
        </div>
      ) : (
        <div className="team-card-grid">
          {teams.map((team) => (
            <button
              key={team.id}
              className="team-card"
              onClick={() => onSelectTeam(team)}
            >
              <div className="team-card-header">
                <span className="team-card-icon">
                  <Icon name="grid" size={16} />
                </span>
                <span className="team-card-name">{team.name}</span>
              </div>
              <p className="team-card-desc">
                {team.description || 'No description yet.'}
              </p>
              <div className="team-card-meta">
                <span>
                  <Icon name="users" size={13} /> {team.member_count ?? 0} members
                </span>
                <span>
                  <Icon name="hash" size={13} /> {channelCount(team)} channels
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default TeamsView;
