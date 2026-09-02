import React from 'react';
import Icon from '../common/Icon';
import type { Channel } from '../../models';

interface ChannelsViewProps {
  channels: Channel[];
  unreadMap: Record<string, number>;
  /** Channel creation is open to employees too (restricted to their teams). */
  canCreateChannel: boolean;
  onOpenChannel: (channel: Channel) => void;
  onCreateChannel: () => void;
}

const ChannelsView = ({
  channels = [],
  unreadMap = {},
  canCreateChannel = false,
  onOpenChannel,
  onCreateChannel,
}: ChannelsViewProps) => (
  <div className="view-page">
    <div className="view-header">
      <div>
        <h1>Channels</h1>
        <p>Organized discussions by topic or team.</p>
      </div>
      {canCreateChannel && (
        <button className="btn-primary" onClick={onCreateChannel}>
          <Icon name="plus" size={14} /> New channel
        </button>
      )}
    </div>

      {channels.length === 0 ? (
        <div className="empty-conversation">
          <div className="empty-conversation-icon">#</div>
          <b>No channels yet</b>
          <p className="center">Create one to get conversations going.</p>
        </div>
      ) : (
        <div className="channel-card-grid">
          {channels.map((channel) => (
            <button
              key={channel.id}
              className="channel-card"
              onClick={() => onOpenChannel(channel)}
            >
              <div className="channel-card-header">
                <span className="channel-card-icon">
                  <Icon name="hash" size={16} />
                </span>
                <span className="channel-card-name">{channel.name}</span>
              </div>
              <p className="channel-card-desc">
                {channel.description || 'No description yet.'}
              </p>
              <div className="channel-card-meta">
                <span className={`status-pill ${channel.type}`}>{channel.type}</span>
                <span className="channel-card-members">
                  <Icon name="users" size={13} /> {channel.member_count ?? 0}
                </span>
              </div>
            </button>
          )
        )}
      </div>
    )}
  </div>
);

export default ChannelsView;
