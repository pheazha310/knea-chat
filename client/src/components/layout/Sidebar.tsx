import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../common/Icon';
import type { IconName } from '../common/Icon';
import Avatar from '../common/Avatar';
import Modal from '../modals/Modal';
import type { User } from '../../models';

export type AppView = 'home' | 'messages' | 'channels' | 'teams' | 'announcements' | 'meetings' | 'attendance' | 'notifs' | 'bookmarks' | 'files' | 'settings';

interface NavItemBase {
  label: string;
  icon: IconName;
}

/** Item that switches the active workspace view. */
interface ViewNavItem extends NavItemBase {
  kind: 'view';
  id: AppView;
}

/** Item that navigates to a separate route. */
interface LinkNavItem extends NavItemBase {
  kind: 'link';
  to: string;
}

type NavItem = ViewNavItem | LinkNavItem;

interface NavGroup {
  title?: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ kind: 'view', id: 'home', label: 'Home', icon: 'home' }],
  },
  {
    title: 'Communication',
    items: [
      { kind: 'view', id: 'messages', label: 'Messages', icon: 'message' },
      { kind: 'view', id: 'channels', label: 'Channels', icon: 'hash' },
      { kind: 'view', id: 'teams', label: 'Teams', icon: 'grid' },
      { kind: 'view', id: 'announcements', label: 'Announcements', icon: 'megaphone' },
      { kind: 'view', id: 'notifs', label: 'Notifs', icon: 'bell' },
    ],
  },
  {
    title: 'Meetings & Attendance',
    items: [
      { kind: 'view', id: 'meetings', label: 'Meetings', icon: 'calendar' },
      { kind: 'view', id: 'attendance', label: 'Attendance', icon: 'clock' },
    ],
  },
  {
    title: 'Library',
    items: [
      { kind: 'view', id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark' },
      { kind: 'view', id: 'files', label: 'Files', icon: 'file' },
    ],
  },
  {
    title: 'User Settings',
    items: [
      { kind: 'link', to: '/profile', label: 'Profile', icon: 'user' },
      { kind: 'view', id: 'settings', label: 'Settings', icon: 'gear' },
    ],
  },
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

const STORAGE_KEY = 'kneachat.sidebar.collapsedGroups';

const readCollapsed = (): Set<string> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
};

const Sidebar = ({ view, onSelectView, unreadCounts, user }: SidebarProps) => {
  const [showHelp, setShowHelp] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);

  // If the active view moves into a collapsed group, expand it so the
  // current page is never hidden.
  useEffect(() => {
    const activeTitle = NAV_GROUPS.find((g) =>
      g.items.some((i) => i.kind === 'view' && i.id === view),
    )?.title;
    if (activeTitle && collapsed.has(activeTitle)) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(activeTitle);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const toggleGroup = (title: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // Storage may be unavailable (private mode) — ignore.
      }
      return next;
    });
  };

  const badgeFor = (id: AppView): number =>
    id === 'messages'
      ? unreadCounts.messages
      : id === 'channels'
        ? unreadCounts.channels
        : id === 'notifs'
          ? unreadCounts.notifs
          : 0;

  const renderItem = (item: NavItem) => {
    const icon = (
      <span className="nav-icon">
        <Icon name={item.icon} size={16} />
      </span>
    );
    if (item.kind === 'link') {
      return (
        <Link key={item.to} to={item.to} className="nav-item">
          {icon}
          <span className="nav-label">{item.label}</span>
        </Link>
      );
    }
    const badge = badgeFor(item.id);
    return (
      <button
        key={item.id}
        className={`nav-item ${view === item.id ? 'active' : ''}`}
        onClick={() => onSelectView(item.id)}
        aria-current={view === item.id ? 'page' : undefined}
      >
        {icon}
        <span className="nav-label">{item.label}</span>
        {badge > 0 && <span className="nav-badge">{badge > 9 ? '9+' : badge}</span>}
      </button>
    );
  };

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
        {NAV_GROUPS.map((group, gi) => {
          const title = group.title;
          const isCollapsed = title ? collapsed.has(title) : false;
          return (
            <div
              className={`sidebar-nav-group${isCollapsed ? ' collapsed' : ''}`}
              key={title ?? `group-${gi}`}
            >
              {title && (
                <button
                  type="button"
                  className="sidebar-nav-group-title"
                  onClick={() => toggleGroup(title)}
                  aria-expanded={!isCollapsed}
                >
                  <span>{title}</span>
                  <Icon name="chevron-down" size={12} />
                </button>
              )}
              {!isCollapsed && group.items.map(renderItem)}
            </div>
          );
        })}
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
