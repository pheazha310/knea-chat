import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Avatar from '../common/Avatar';
import Icon from '../common/Icon';
import { roleLabel } from '../../utils/roles';
import type { User } from '../../models';

interface SettingsViewProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  user: User | null;
}

type PrefKey = 'mention_toasts' | 'message_toasts' | 'sound';

const DEFAULT_PREFS: Record<PrefKey, boolean> = {
  mention_toasts: true,
  message_toasts: true,
  sound: true,
};

const SettingsView = ({ theme, onToggleTheme, user }: SettingsViewProps) => {
  const [prefs, setPrefs] = useState<Record<PrefKey, boolean>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('kneachat_notif_prefs') || '{}');
      return { ...DEFAULT_PREFS, ...stored };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  });

  const togglePref = (key: PrefKey) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem('kneachat_notif_prefs', JSON.stringify(next));
      return next;
    });
  };

  const prefsRows: Array<{ key: PrefKey; label: string; hint: string }> = [
    { key: 'mention_toasts', label: 'Mention alerts', hint: 'Toast when someone @mentions you' },
    { key: 'message_toasts', label: 'New message alerts', hint: 'Toast when a new message arrives' },
    { key: 'sound', label: 'Sounds', hint: 'Play a sound for new notifications' },
  ];

  const name = user ? `${user.first_name} ${user.last_name}`.trim() : '';

  return (
    <div className="view-page">
      <div className="view-header">
        <div>
          <h1>Settings</h1>
          <p>Appearance, account, and notification preferences.</p>
        </div>
      </div>

      <div className="settings-grid">
        <section className="settings-card">
          <h2>Appearance</h2>
          <div className="setting-row">
            <span>
              <b>Theme</b>
              <small>Switch between light and dark mode</small>
            </span>
            <div className="theme-seg">
              <button
                className={theme === 'light' ? 'on' : ''}
                onClick={() => theme === 'dark' && onToggleTheme()}
              >
                <Icon name="sun" size={16} /> Light
              </button>
              <button
                className={theme === 'dark' ? 'on' : ''}
                onClick={() => theme === 'light' && onToggleTheme()}
              >
                <Icon name="moon" size={16} /> Dark
              </button>
            </div>
          </div>
        </section>

        <section className="settings-card">
          <h2>Account</h2>
          <div className="setting-row">
            <Avatar person={user} className="settings-lg" />
            <span className="account-main">
              <b>{name}</b>
              <small>
                {user?.email} · {roleLabel(user?.role)}
              </small>
            </span>
            <Link to="/profile" className="btn-secondary">
              Edit profile
            </Link>
          </div>
        </section>

        <section className="settings-card">
          <h2>Notifications</h2>
          {prefsRows.map((row) => (
            <div className="setting-row" key={row.key}>
              <span>
                <b>{row.label}</b>
                <small>{row.hint}</small>
              </span>
              <button
                className={`toggle ${prefs[row.key] ? 'on' : ''}`}
                onClick={() => togglePref(row.key)}
                aria-pressed={prefs[row.key]}
                aria-label={row.label}
              />
            </div>
          ))}
        </section>

        <section className="settings-card">
          <h2>About</h2>
          <div className="setting-row">
            <span>
              <b>KneaChat</b>
              <small>Connect. Communicate. Work Together.</small>
            </span>
            <span className="text-muted version-text">v1.0.0</span>
          </div>
        </section>
      </div>
    </div>
  );
};

export default SettingsView;
