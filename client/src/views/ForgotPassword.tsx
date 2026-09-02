import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthModel } from '../models';
import Icon from '../components/common/Icon';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await AuthModel.forgotPassword(email);
      // Development convenience: until email delivery is configured, the API
      // returns the reset token so the flow stays testable end-to-end.
      setResetToken(res.data.data?.resetToken || null);
      setSent(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.');
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
        <h2>{sent ? 'Check your inbox' : 'Reset your password'}</h2>
        <p className="auth-sub">
          {sent
            ? 'We sent you a reset link.'
            : 'Enter your email and we will send you a reset link.'}
        </p>

        {sent ? (
          <div className="auth-success-card">
            <span className="auth-success-icon">
              <Icon name="message" size={26} strokeWidth={1.4} />
            </span>
            <p>
              If an account exists for <b>{email}</b>, a password reset link is on
              its way. Check your inbox (and spam folder).
            </p>
            {resetToken && (
              <div className="auth-dev-note">
                <p>
                  <b>Development mode:</b> email delivery is not configured, so
                  here is your reset link:
                </p>
                <Link
                  to={`/reset-password?token=${encodeURIComponent(resetToken)}`}
                  className="auth-btn auth-btn-warning"
                >
                  Open reset page
                  <Icon name="arrow-right" size={14} />
                </Link>
              </div>
            )}
            <Link to="/login" className="auth-btn">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <div className="auth-error">{error}</div>}
            <div className="auth-field">
              <label htmlFor="email">Email address</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">
                  <Icon name="message" size={15} />
                </span>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                  autoFocus
                  className="auth-input"
                />
              </div>
            </div>
            <button type="submit" disabled={loading || !email} className="auth-btn">
              {loading ? (
                <>
                  <span className="auth-spinner" aria-hidden="true" />
                  Sending…
                </>
              ) : (
                'Send reset link'
              )}
            </button>
            <Link to="/login" className="auth-link auth-link-center">
              Remembered your password? Sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
