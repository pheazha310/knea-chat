import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthModel } from '../models';

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
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: 24,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>📬</div>
            <p style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 18px' }}>
              If an account exists for <b style={{ color: 'var(--text)' }}>{email}</b>, a password
              reset link is on its way. Check your inbox (and spam folder).
            </p>
            {resetToken && (
              <div
                style={{
                  marginBottom: 16,
                  padding: 12,
                  background: 'var(--warning-soft)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 10,
                  textAlign: 'left',
                }}
              >
                <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--warning)' }}>
                  <b>Development mode:</b> email delivery is not configured, so here is your reset
                  link:
                </p>
                <Link
                  to={`/reset-password?token=${encodeURIComponent(resetToken)}`}
                  className="auth-btn"
                  style={{ display: 'block', textAlign: 'center', textDecoration: 'none', background: 'var(--warning)', color: '#241a02' }}
                >
                  Open reset page →
                </Link>
              </div>
            )}
            <Link
              to="/login"
              className="auth-btn"
              style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <div className="auth-error">{error}</div>}
            <div className="auth-field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="auth-input"
              />
            </div>
            <button type="submit" disabled={loading || !email} className="auth-btn">
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
            <Link to="/login" className="auth-link" style={{ display: 'block', textAlign: 'center', marginTop: 20 }}>
              Remembered your password? Sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
