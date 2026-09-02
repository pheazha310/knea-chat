import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../common/Icon';
import type { IconName } from '../common/Icon';
import Avatar from '../common/Avatar';
import Modal from '../modals/Modal';
import type { User } from '../../models';

export type AppView = 'home' | 'messages' | 'channels' | 'teams' | 'announcements' | 'meetings' | 'notifs' | 'bookmarks' | 'files' | 'settings';

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
  { id: 'meetings', label: 'Meetings', icon: 'calendar' },
];

/** Rows shown in the Help & resources dialog. */
const SHORTCUTS: Array<{ keys: string[]; action: string }> = [
  { keys: ['⌘', 'K'], action: 'Search channels, people and messages' },
  { keys: ['Enter'], action: 'Send the message you are typing' },
  { keys: ['Shift', 'Enter'], action: 'Start a new line in the composer' },
  { keys: ['@'], action: 'Mention a teammate in the composer' },
  { keys: ['Esc'], action: 'Close dialogs, pickers and panels' },
];

interface SidebarProps {
  view: AppView;
  onSelectView: (view: AppView) => void;
  unreadCounts: { messages: number; channels: number; notifs: number };
  user?: User | null;
}

const Sidebar = ({ view, onSelectView, unreadCounts, user }: SidebarProps) => {
  const [showHelp, setShowHelp] = useState(false);

  return (
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

      <nav className="sidebar-nav" aria-label="Workspace">
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
              aria-current={view === item.id ? 'page' : undefined}
            >
              <span className="nav-icon"><Icon name={item.icon} size={16} /></span>
              <span className="nav-label">{item.label}</span>
              {badge > 0 && <span className="nav-badge">{badge > 9 ? '9+' : badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-divider" />

      <nav className="sidebar-nav" aria-label="Account">
        <Link to="/profile" className="nav-item">
          <span className="nav-icon"><Icon name="user" size={16} /></span>
          <span className="nav-label">Profile</span>
        </Link>
      </nav>

      <div className="sidebar-footer">
        <button className="sidebar-help" onClick={() => setShowHelp(true)}>
          <Icon name="info" size={16} />
          <span>Help &amp; resources</span>
        </button>
      </div>

      {showHelp && (
        <Modal
          title="Help & keyboard shortcuts"
          onClose={() => setShowHelp(false)}
          width={480}
        >
          <ul className="shortcuts-list">
            {SHORTCUTS.map((s) => (
              <li className="shortcut-row" key={s.action}>
                <span className="shortcut-action">{s.action}</span>
                <span className="shortcut-keys">
                  {s.keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <div className="shortcut-note">
            <Icon name="sparkles" size={14} />
            <p>
              Attach files with the paperclip, drag them onto the composer, or
              paste from the clipboard. Use the microphone to record a voice note.
            </p>
          </div>
        </Modal>
      )}
    </aside>
  );
};

export default Sidebar;
