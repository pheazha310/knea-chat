import React from 'react';
import Avatar from '../common/Avatar';
import Icon from '../common/Icon';
import type { Notification, User } from '../../models';

interface WelcomeViewProps {
  user: User | null;
  onlineCount: number;
  unreadCount: number;
  channelCount: number;
  teamCount: number;
  notifications: Notification[];
  onBrowseChannels: () => void;
  onStartChat: () => void;
  onSearch: () => void;
}

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 5) return 'Burning the midnight oil';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

// Retained for the legacy landing-card variant; the employee dashboard uses
// its own compact visual indicators.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const StatIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'online':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="10" cy="10" r="4" fill="currentColor" />
          <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
        </svg>
      );
    case 'unread':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 3C6.13 3 3 6.13 3 10C3 12.06 3.87 13.91 5.26 15.24L5.2 15.8C5.08 16.64 5.82 17.35 6.65 17.13C7.35 16.94 8.09 16.84 8.85 16.84C9.46 16.84 10.06 16.9 10.65 17.02C11.22 17.13 11.75 16.75 11.85 16.19C11.94 15.65 11.57 15.16 11.03 15.07C10.52 14.99 10 14.96 9.48 14.96C8.15 14.96 6.85 15.26 5.68 15.82C5.16 16.06 5.19 16.84 5.73 17.09C7.07 17.77 8.55 18.12 10.08 18.12C11.61 18.12 13.09 17.77 14.43 17.09C14.97 16.84 15 16.06 14.48 15.82C13.31 15.26 12.01 14.96 10.68 14.96C10.16 14.96 9.64 14.99 9.13 15.07C8.59 15.16 8.22 15.65 8.31 16.19C8.41 16.75 8.94 17.13 9.51 17.02C10.1 16.9 10.7 16.84 11.31 16.84C12.07 16.84 12.81 16.94 13.51 17.13C14.34 17.35 15.08 16.64 14.96 15.8L14.9 15.24C16.29 13.91 17.16 12.06 17.16 10C17.16 6.13 14.03 3 10 3Z" fill="currentColor" opacity="0.15"/>
          <path d="M7.5 8.5L8.5 9.5L12.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6"/>
          <circle cx="10" cy="13" r="1.5" fill="currentColor" opacity="0.8"/>
        </svg>
      );
    case 'channels':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 4H16V7H4V4Z" fill="currentColor" opacity="0.2"/>
          <path d="M4 4H16V7H4V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M4 10H16V13H4V10Z" fill="currentColor" opacity="0.2"/>
          <path d="M4 10H16V13H4V10Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M7 16H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
    case 'teams':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="7" cy="7" r="2.5" fill="currentColor" opacity="0.3"/>
          <circle cx="13" cy="7" r="2.5" fill="currentColor" opacity="0.3"/>
          <circle cx="7" cy="13" r="2.5" fill="currentColor" opacity="0.3"/>
          <circle cx="13" cy="13" r="2.5" fill="currentColor" opacity="0.3"/>
          <path d="M7 9.5C7 10.33 6.33 11 5.5 11C4.67 11 4 10.33 4 9.5C4 8.67 4.67 8 5.5 8C6.33 8 7 8.67 7 9.5Z" fill="currentColor"/>
          <path d="M13 9.5C13 10.33 12.33 11 11.5 11C10.67 11 10 10.33 10 9.5C10 8.67 10.67 8 11.5 8C12.33 8 13 8.67 13 9.5Z" fill="currentColor"/>
          <path d="M7 15.5C7 16.33 6.33 17 5.5 17C4.67 17 4 16.33 4 15.5C4 14.67 4.67 14 5.5 14C6.33 14 7 14.67 7 15.5Z" fill="currentColor"/>
          <path d="M13 15.5C13 16.33 12.33 17 11.5 17C10.67 17 10 16.33 10 15.5C10 14.67 10.67 14 11.5 14C12.33 14 13 14.67 13 15.5Z" fill="currentColor"/>
        </svg>
      );
    default:
      return null;
  }
};

const WelcomeView = ({
  user,
  onlineCount,
  unreadCount,
  channelCount,
  teamCount,
  notifications,
  onBrowseChannels,
  onStartChat,
  onSearch,
}: WelcomeViewProps) => {
  const firstName = user?.first_name || 'there';

  const recentActivity = notifications.slice(0, 3);
  const focusItems = [
    unreadCount > 0
      ? { title: `${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`, detail: 'Catch up on the conversations that need your attention.', action: 'Review inbox', onClick: onSearch, tone: 'urgent' }
      : { title: 'Your inbox is clear', detail: 'You are all caught up on workspace messages.', action: 'Browse channels', onClick: onBrowseChannels, tone: 'calm' },
    { title: `${onlineCount} teammate${onlineCount === 1 ? '' : 's'} online`, detail: 'Start a conversation or see what your team is discussing.', action: 'Start a chat', onClick: onStartChat, tone: 'progress' },
  ];

  return (
    <div className="employee-home">
      <header className="employee-home-heading">
        <div>
          <span className="employee-home-kicker">My workspace</span>
          <h2>{greeting()}, {firstName}<span className="wave" aria-hidden="true"> 👋</span></h2>
          <p>Here’s a quick view of what needs your attention today.</p>
        </div>
        <div className="employee-home-user"><Avatar person={user} className="small" showStatus /> <span>Online</span></div>
      </header>

      <div className="employee-home-grid">
        <section className="employee-focus">
          <div className="employee-section-heading"><div><span>Your focus</span><p>Keep your work moving forward.</p></div><button onClick={onSearch}>View inbox <Icon name="arrow-right" size={12} /></button></div>
          <div className="employee-focus-list">
            {focusItems.map((item) => (
              <article className="employee-focus-item" key={item.title}>
                <span className={`employee-focus-dot ${item.tone}`} />
                <div><h3>{item.title}</h3><p>{item.detail}</p><button onClick={item.onClick}>{item.action} <Icon name="arrow-right" size={12} /></button></div>
              </article>
            ))}
          </div>
          <div className="employee-goal">
            <div><span>WORKSPACE SNAPSHOT</span><strong>{channelCount} channels · {teamCount} teams</strong><p>Your shared spaces are ready when you are.</p></div>
            <div className="employee-goal-ring"><b>{Math.min(100, Math.max(15, 100 - unreadCount * 4))}%</b><small>clear</small></div>
          </div>
        </section>

        <aside className="employee-activity">
          <div className="employee-section-heading"><div><span>Workspace pulse</span><p>Latest activity for you.</p></div></div>
          {recentActivity.length ? <div className="employee-activity-list">{recentActivity.map((item) => <article key={item.id}><span className={`employee-activity-icon ${item.is_read ? '' : 'new'}`}>{item.type === 'mention' ? '@' : <Icon name="bell" size={11} />}</span><div><h3>{item.title}</h3><p>{item.message || 'There is new activity in your workspace.'}</p><time>{new Date(item.created_at).toLocaleDateString()}</time></div></article>)}</div> : <div className="employee-activity-empty"><span><Icon name="sparkles" size={18} /></span><b>No new activity</b><p>When teammates mention you or share an update, it will appear here.</p></div>}
          <button className="employee-activity-footer" onClick={onSearch}>View all activity</button>
        </aside>
      </div>

      <section className="employee-quick-actions">
        <div className="employee-section-heading"><div><span>Quick actions</span><p>Jump back into your workspace.</p></div></div>
        <div className="employee-quick-grid">
          <button onClick={onStartChat}><i><Icon name="message" size={15} /></i><b>Start a chat</b><small>Message a teammate</small></button>
          <button onClick={onBrowseChannels}><i><Icon name="hash" size={15} /></i><b>Browse channels</b><small>Explore shared spaces</small></button>
          <button onClick={onSearch}><i><Icon name="search" size={15} /></i><b>Search workspace</b><small>Find messages and people</small></button>
        </div>
      </section>
    </div>
  );
};

export default WelcomeView;
