import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../common/Icon';
import type { IconName } from '../common/Icon';
import Avatar from '../common/Avatar';
import type { User } from '../../models';

export type AppView = 'home' | 'messages' | 'channels' | 'teams' | 'announcements' | 'notifs' | 'bookmarks' | 'files' | 'settings';

const NAV_ITEMS: Array<{ id: AppView; label: string; icon: IconName }> = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'messages', label: 'Messages', icon: 'message' },
  { id: 'channels', label: 'Channels', icon: 'hash' },
  { id: 'teams', label: 'Teams', icon: 'grid' },
  { id: 'announcements', label: 'Announcements', icon: 'megaphone' },
  { id: 'notifs', label: 'Notifs', icon: 'bell' },
  { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark' },
  { id: 'files', label: 'Files', icon: 'file' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
];

interface SidebarProps {
  view: AppView;
  onSelectView: (view: AppView) => void;
  unreadCounts: { messages: number; channels: number; notifs: number };
  user?: User | null;
}

const Sidebar = ({ view, onSelectView, unreadCounts, user }: SidebarProps) => (
  <aside className="sidebar">
    <div className="sidebar-brand">
      <span className="sidebar-brand-mark">k</span>
      <span className="sidebar-brand-text">KneaChat</span>
    </div>

    {user && (
      <div className="sidebar-user-info">
        <Avatar person={user} className="small" showStatus />
        <div>
          <div className="sidebar-user-email">{user.email}</div>
          <div className="sidebar-user-status">
            <span className="sidebar-status-dot" />
            <span>Online</span>
          </div>
        </div>
      </div>
    )}

    <nav className="sidebar-nav">
      {NAV_ITEMS.map((item) => {
        const badge =
          item.id === 'messages'
            ? unreadCounts.messages
            : item.id === 'channels'
              ? unreadCounts.channels
              : item.id === 'notifs'
                ? unreadCounts.notifs
                : 0;
        return (
          <button
            key={item.id}
            className={`nav-item ${view === item.id ? 'active' : ''}`}
            onClick={() => onSelectView(item.id)}
          >
            <span className="nav-icon"><Icon name={item.icon} size={16} /></span>
            <span className="nav-label">{item.label}</span>
            {badge > 0 && <span className="nav-badge">{badge > 9 ? '9+' : badge}</span>}
          </button>
        );
      })}
    </nav>

    <div className="sidebar-divider" />

    <nav className="sidebar-nav">
      <Link to="/profile" className="nav-item">
        <span className="nav-icon"><Icon name="user" size={16} /></span>
        <span className="nav-label">Profile</span>
      </Link>
    </nav>

    <div className="sidebar-footer">
      <button className="sidebar-help">
        <Icon name="info" size={16} />
        <span>Help &amp; resources</span>
      </button>
    </div>
  </aside>
);

export default Sidebar;
