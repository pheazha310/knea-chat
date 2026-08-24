import React, { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { AuthModel } from '../models';

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await AuthModel.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 1800);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Reset failed. The link may be invalid or expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell centered">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="brand-mark">k</span>
          <b>KneaChat</b>
        </div>
        <h2>Choose a new password</h2>
        <p className="auth-sub">Pick a strong password you have not used before.</p>

        <form onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}
          {done && (
            <div
              className="auth-error"
              style={{
                background: 'var(--success-soft)',
                borderColor: 'var(--border-strong)',
                color: 'var(--success)',
              }}
            >
              Password updated — redirecting to sign in…
            </div>
          )}
          {!token && (
            <div
              className="auth-error"
              style={{ background: 'var(--warning-soft)', borderColor: 'var(--border-strong)', color: 'var(--warning)' }}
            >
              Missing reset token. Open the link from your reset email.
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="password">New password</label>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              disabled={!token || done}
              className="auth-input"
            />
          </div>
          <div className="auth-field">
            <label htmlFor="confirm">Confirm new password</label>
            <input
              id="confirm"
              type={showPassword ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat the password"
              required
              disabled={!token || done}
              className="auth-input"
            />
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12.5,
              color: 'var(--text-muted)',
              marginBottom: 18,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            Show passwords
          </label>
          <button
            type="submit"
            disabled={loading || !token || done || !password || !confirm}
            className="auth-btn"
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>
          <Link to="/login" className="auth-link" style={{ display: 'block', textAlign: 'center', marginTop: 20 }}>
            Back to sign in
          </Link>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;
