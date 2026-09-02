import React, { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { AuthModel } from '../models';
import Icon from '../components/common/Icon';

const MIN_PASSWORD_LENGTH = 6;

/* Same scoring as the login page so the meter reads consistently. */
const strengthOf = (pw: string, minLen: number) => {
  if (!pw) return { score: 0, label: '' };
  let score = 0;
  if (pw.length >= minLen) score += 1;
  if (/[a-z]/.test(pw) && /[0-9]/.test(pw)) score += 1;
  if (/[A-Z]/.test(pw) || /[^a-zA-Z0-9]/.test(pw)) score += 1;
  if (pw.length >= 12) score += 1;
  return { score, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][score] };
};

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

  const strength = strengthOf(password, MIN_PASSWORD_LENGTH);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
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
        <h2>{done ? 'Password updated' : 'Choose a new password'}</h2>
        <p className="auth-sub">
          {done
            ? 'You can now sign in with your new password.'
            : 'Pick a strong password you have not used before.'}
        </p>

        {done ? (
          <div className="auth-success-card">
            <span className="auth-success-icon">
              <Icon name="check-circle" size={26} strokeWidth={1.6} />
            </span>
            <p>Your password has been updated — redirecting to sign in…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <div className="auth-error">{error}</div>}
            {!token && (
              <div className="auth-error auth-error-warning">
                Missing reset token. Open the link from your reset email.
              </div>
            )}

            <div className="auth-field">
              <label htmlFor="password">New password</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">
                  <Icon name="key" size={15} />
                </span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  autoComplete="new-password"
                  required
                  autoFocus
                  disabled={!token}
                  className="auth-input auth-input-password"
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
                >
                  <Icon name={showPassword ? 'eye-off' : 'eye'} size={15} />
                </button>
              </div>
              {password && (
                <div className="auth-strength">
                  <div className="auth-strength-bars">
                    {[1, 2, 3, 4].map((bar) => (
                      <i
                        key={bar}
                        className={strength.score >= bar ? `on-${strength.score}` : ''}
                      />
                    ))}
                  </div>
                  <span className="auth-strength-label">{strength.label}</span>
                </div>
              )}
            </div>
            <div className="auth-field">
              <label htmlFor="confirm">Confirm new password</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">
                  <Icon name="key" size={15} />
                </span>
                <input
                  id="confirm"
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat the password"
                  autoComplete="new-password"
                  required
                  disabled={!token}
                  className="auth-input auth-input-password"
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
                >
                  <Icon name={showPassword ? 'eye-off' : 'eye'} size={15} />
                </button>
              </div>
              {confirm && confirm !== password && (
                <div className="auth-field-error">
                  <span aria-hidden="true">⚠</span> Passwords do not match
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !token || !password || !confirm}
              className="auth-btn"
            >
              {loading ? (
                <>
                  <span className="auth-spinner" aria-hidden="true" />
                  Updating…
                </>
              ) : (
                'Update password'
              )}
            </button>
            <Link to="/login" className="auth-link auth-link-center">
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
