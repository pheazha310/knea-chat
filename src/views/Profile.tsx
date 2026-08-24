import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store';
import Avatar from '../components/common/Avatar';
import Icon from '../components/common/Icon';
import { AuthModel, UserModel } from '../models';
import type { PresenceStatus, User } from '../models';

const STATUSES: Array<{ value: PresenceStatus; label: string; color: string }> = [
  { value: 'online', label: 'Online', color: 'bg-green-500' },
  { value: 'away', label: 'Away', color: 'bg-yellow-500' },
  { value: 'dnd', label: 'Do not disturb', color: 'bg-red-500' },
  { value: 'offline', label: 'Offline', color: 'bg-gray-400' },
];

const Profile = () => {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const setUser = useAuthStore((s) => s.setUser);
  const [form, setForm] = useState({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    job_title: user?.job_title || '',
    email: user?.email || '',
    status: (user?.status || 'online') as PresenceStatus,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showPw, setShowPw] = useState({ current: false, new: false, confirm: false });

  useEffect(() => {
    if (user) {
      setForm({
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        job_title: user.job_title || '',
        email: user.email || '',
        status: (user.status || 'online') as PresenceStatus,
      });
      setAvatarPreview((user as any).profile_picture || null);
    }
  }, [user]);

  // Upload the photo as a file — the profile_picture column is VARCHAR(500),
  // so a base64 data URL (megabytes) can never be stored via PATCH /users/:id.
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Avatar image must be under 2MB');
      e.target.value = '';
      return;
    }
    setError(null);
    setAvatarUploading(true);
    try {
      const res = await UserModel.uploadAvatar(user!.id, file);
      const updated: User = res.data.data.user;
      setUser(updated);
      setAvatarPreview(updated.profile_picture || null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not update profile picture');
    } finally {
      setAvatarUploading(false);
      e.target.value = '';
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await UserModel.update(user!.id, {
        first_name: form.first_name,
        last_name: form.last_name,
        job_title: form.job_title || null,
        status: form.status,
      });
      const updated: User = res.data.data.user;
      setUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not save profile');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (pw.newPassword !== pw.confirm) {
      setPwMsg({ ok: false, text: 'New passwords do not match' });
      return;
    }
    if (pw.newPassword.length < 6) {
      setPwMsg({ ok: false, text: 'New password must be at least 6 characters' });
      return;
    }
    setPwSaving(true);
    try {
      await AuthModel.changePassword(pw.currentPassword, pw.newPassword);
      setPwMsg({ ok: true, text: 'Password updated successfully' });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err: any) {
      setPwMsg({ ok: false, text: err.response?.data?.message || 'Could not change password' });
    } finally {
      setPwSaving(false);
    }
  };

  const inputCls =
    'w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lavender/40 focus:border-lavender text-sm transition-colors bg-white';
  const labelCls = 'block text-sm font-semibold text-ink mb-1.5';

  return (
    <div className="profile-page">
      <header className="topbar page-topbar">
        <div className="brand">
          <span className="brand-mark">k</span>
          <span>KneaChat</span>
        </div>
        <nav className="page-topbar-actions">
          <Link to="/dashboard" className="topbar-link">
            <Icon name="arrow-left" size={14} /><span className="page-topbar-action-label">Back to workspace</span>
          </Link>
          <span className="page-topbar-divider" aria-hidden="true" />
          <button onClick={logout} className="topbar-signout">
            Sign out
          </button>
        </nav>
      </header>

      <main className="profile-content">
        <div className="profile-hero">
          <div className="profile-avatar-wrap group">
            <Avatar
              person={{ ...user, status: form.status }}
              photo={avatarPreview}
              className="profile-lg"
              showStatus
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={avatarUploading}
              className="profile-avatar-change"
            >
              {avatarUploading ? 'Uploading…' : 'Change photo'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>
          <div className="profile-hero-copy">
            <span className="profile-eyebrow">Account settings</span>
            <h1>
              {form.first_name} {form.last_name}
            </h1>
            <p>
              {form.job_title || 'No job title'} · {form.email}
            </p>
            <span className={`profile-status status-${form.status}`}>{form.status.replace('dnd', 'do not disturb')}</span>
          </div>
        </div>

        <div className="profile-settings-grid">
          <form
            onSubmit={handleProfileSubmit}
            className="profile-settings-card"
          >
            <div className="profile-card-heading"><span>◉</span><div><h2>Profile details</h2><p>Update how teammates see you in KneaChat.</p></div></div>
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            )}
            {saved && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
                Profile saved ✓
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className={labelCls}>First name</label>
                <input
                  className={inputCls}
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className={labelCls}>Last name</label>
                <input
                  className={inputCls}
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="mb-4">
              <label className={labelCls}>Job title</label>
              <input
                className={inputCls}
                value={form.job_title}
                placeholder="e.g. Senior Engineer"
                onChange={(e) => setForm({ ...form, job_title: e.target.value })}
              />
            </div>
            <div className="mb-5">
              <label className={labelCls}>Email (login)</label>
              <input
                className={`${inputCls} bg-gray-50 text-gray-500 cursor-not-allowed`}
                value={form.email}
                disabled
              />
            </div>
            <div className="mb-6">
              <label className={labelCls}>Status</label>
              <select
                className={inputCls}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as PresenceStatus })}
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full btn-primary disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </form>

          <form
            onSubmit={handlePasswordSubmit}
            className="profile-settings-card"
          >
            <div className="profile-card-heading"><span>⌑</span><div><h2>Security</h2><p>Use a strong password to protect your account.</p></div></div>
            {pwMsg && (
              <div
                className={`mb-4 p-3 rounded-lg text-sm ${
                  pwMsg.ok
                    ? 'bg-green-50 border border-green-200 text-green-700'
                    : 'bg-red-50 border border-red-200 text-red-700'
                }`}
              >
                {pwMsg.text}
              </div>
            )}
            <div className="mb-4 relative">
              <label className={labelCls}>Current password</label>
              <input
                type={showPw.current ? 'text' : 'password'}
                className={inputCls}
                value={pw.currentPassword}
                onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                required
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => ({ ...s, current: !s.current }))}
                className="absolute right-3 top-8 text-gray-400 hover:text-gray-600 text-sm"
              >
                {showPw.current ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="mb-4 relative">
              <label className={labelCls}>New password</label>
              <input
                type={showPw.new ? 'text' : 'password'}
                className={inputCls}
                value={pw.newPassword}
                onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
                required
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => ({ ...s, new: !s.new }))}
                className="absolute right-3 top-8 text-gray-400 hover:text-gray-600 text-sm"
              >
                {showPw.new ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="mb-6 relative">
              <label className={labelCls}>Confirm new password</label>
              <input
                type={showPw.confirm ? 'text' : 'password'}
                className={inputCls}
                value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                required
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => ({ ...s, confirm: !s.confirm }))}
                className="absolute right-3 top-8 text-gray-400 hover:text-gray-600 text-sm"
              >
                {showPw.confirm ? 'Hide' : 'Show'}
              </button>
            </div>
            <button
              type="submit"
              disabled={pwSaving}
              className="w-full profile-security-btn"
            >
              {pwSaving ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default Profile;
