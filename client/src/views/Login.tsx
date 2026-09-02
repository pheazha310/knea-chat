import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import Icon from '../components/common/Icon';
import { useAuthStore } from '../store';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { SystemSettingModel } from '../models';

const DEMO_ACCOUNTS = [
  { label: 'Super Admin demo', sub: 'Platform access', email: 'super@kneachat.com', password: 'kneachat168' },
  { label: 'Admin demo', sub: 'Admin access', email: 'admin@kneachat.com', password: 'kneachat168' },
  { label: 'Employee demo', sub: 'Maya Chen', email: 'maya@kneachat.com', password: 'kneachat168' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* -------------------------------------------------------------------------- */
/* Inline SVG icons                                                           */
/* -------------------------------------------------------------------------- */
const EmailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="4" width="20" height="16" rx="3" />
    <path d="m2 7 10 6 10-6" />
  </svg>
);
const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="10" width="16" height="11" rx="3" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);
const UserIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
  </svg>
);
const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.46H12v4.66h6.45a5.53 5.53 0 0 1-2.4 3.63v3.02h3.89c2.27-2.09 3.56-5.17 3.56-8.85z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.89-3.02c-1.08.72-2.46 1.15-4.05 1.15-3.12 0-5.76-2.11-6.7-4.94H1.29v3.12A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.3 14.28a7.2 7.2 0 0 1 0-4.56V6.6H1.29a12 12 0 0 0 0 10.8l4.01-3.12z" />
    <path fill="#EA4335" d="M12 4.78c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.6l4.01 3.12C6.24 6.89 8.88 4.78 12 4.78z" />
  </svg>
);
const GithubIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
  </svg>
);

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                         */
/* -------------------------------------------------------------------------- */
interface Values {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

const validateField = (name: keyof Values, v: Values, minLen: number): string => {
  switch (name) {
    case 'firstName':
      return v.firstName.trim() ? '' : 'First name is required';
    case 'lastName':
      return v.lastName.trim() ? '' : 'Last name is required';
    case 'email': {
      const e = v.email.trim();
      if (!e) return 'Email is required';
      return EMAIL_RE.test(e) ? '' : 'Enter a valid email address';
    }
    case 'password':
      if (!v.password) return 'Password is required';
      return v.password.length >= minLen
        ? ''
        : `Use at least ${minLen} characters`;
    case 'confirmPassword':
      if (!v.confirmPassword) return 'Please confirm your password';
      return v.confirmPassword === v.password ? '' : 'Passwords do not match';
    default:
      return '';
  }
};

const strengthOf = (pw: string, minLen: number) => {
  if (!pw) return { score: 0, label: '' };
  let score = 0;
  if (pw.length >= minLen) score += 1;
  if (/[a-z]/.test(pw) && /[0-9]/.test(pw)) score += 1;
  if (/[A-Z]/.test(pw) || /[^a-zA-Z0-9]/.test(pw)) score += 1;
  if (pw.length >= 12) score += 1;
  return { score, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][score] };
};

/* -------------------------------------------------------------------------- */
/* Reusable form field with icon, error state and password toggle             */
/* -------------------------------------------------------------------------- */
interface FieldProps {
  name: keyof Values;
  label: string;
  icon: React.ReactNode;
  type?: string;
  value: string;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  error?: string;
  valid?: boolean;
  showToggle?: boolean;
  showPassword?: boolean;
  onTogglePassword?: () => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  children?: React.ReactNode;
}

const Field = ({
  name,
  label,
  icon,
  type = 'text',
  value,
  placeholder,
  autoComplete,
  autoFocus,
  error,
  valid,
  showToggle,
  showPassword,
  onTogglePassword,
  onChange,
  onBlur,
  children,
}: FieldProps) => (
  <div
    className={`auth-field ${error ? 'invalid' : ''} ${valid ? 'valid' : ''}`}
  >
    <label htmlFor={name}>{label}</label>
    <div className="auth-input-wrap">
      <span className="auth-input-icon">{icon}</span>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        onChange={onChange}
        onBlur={onBlur}
        className={`auth-input ${type === 'password' ? 'auth-input-password' : ''}`}
      />
      {showToggle && (
        <button
          type="button"
          className="auth-password-toggle"
          onClick={onTogglePassword}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          <Icon name={showPassword ? 'eye-off' : 'eye'} size={15} />
        </button>
      )}
    </div>
    {error && (
      <div className="auth-field-error">
        <span aria-hidden="true">⚠</span> {error}
      </div>
    )}
    {children}
  </div>
);

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */
const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [publicSettings, setPublicSettings] = useState<{
    maintenance_mode?: boolean;
    allow_public_registration?: boolean;
    password_min_length?: number;
  }>({});
  const { login, register, loading, error, clearError } = useAuthStore();
  const { theme, toggleTheme } = useTheme();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/dashboard';
  const registrationClosed = publicSettings.allow_public_registration === false;
  const maintenanceOn = publicSettings.maintenance_mode === true;
  const minPasswordLength = publicSettings.password_min_length ?? 6;

  const values: Values = { firstName, lastName, email, password, confirmPassword };

  // Public platform settings: hide registration when it's disabled and show a
  // maintenance banner when the platform is under maintenance.
  useEffect(() => {
    let mounted = true;
    SystemSettingModel
      .getPublic()
      .then((res) => {
        if (mounted) setPublicSettings(res.data.data.settings || {});
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const update = (name: keyof Values, value: string) => {
    if (name === 'email') setEmail(value);
    else if (name === 'password') setPassword(value);
    else if (name === 'firstName') setFirstName(value);
    else if (name === 'lastName') setLastName(value);
    else if (name === 'confirmPassword') setConfirmPassword(value);
    clearError();

    const next: Values = { ...values, [name]: value };
    // Re-validate live once the form has been submitted (or the field already
    // showed an error), and keep the confirm field in sync when password changes.
    if (submitted || errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: validateField(name, next, minPasswordLength) }));
    }
    if (name === 'password' && (submitted || errors.confirmPassword)) {
      setErrors((prev) => ({
        ...prev,
        confirmPassword: validateField('confirmPassword', next, minPasswordLength),
      }));
    }
  };

  const handleBlur = (name: keyof Values) => () => {
    setErrors((prev) => ({ ...prev, [name]: validateField(name, values, minPasswordLength) }));
  };

  const handleSocial = () => {
    showToast('Social sign-in is not configured yet — use email instead.', {
      type: 'info',
      title: 'Coming soon',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    const fieldsToCheck: (keyof Values)[] = isRegistering
      ? ['firstName', 'lastName', 'email', 'password', 'confirmPassword']
      : ['email', 'password'];

    const nextErrors: Partial<Record<keyof Values, string>> = {};
    let hasError = false;
    for (const field of fieldsToCheck) {
      const message = validateField(field, values, minPasswordLength);
      if (message) {
        nextErrors[field] = message;
        hasError = true;
      }
    }
    setErrors(nextErrors);
    setSubmitted(true);
    if (hasError) return;

    const result = isRegistering
      ? await register({ firstName, lastName, email, password })
      : await login({ email, password });
    if (result.success) {
      navigate(from, { replace: true });
    }
  };

  const strength = strengthOf(password, minPasswordLength);
  const toggleRegister = () => {
    setIsRegistering((v) => !v);
    clearError();
  };

  return (
    <div className="auth-shell">
      {/* ------------------------------ Hero ------------------------------ */}
      <aside className="auth-hero">
        <div className="auth-hero-inner">
          <div className="auth-hero-head">
            <span className="brand-mark">k</span>
            <b>KneaChat</b>
          </div>

          <div className="auth-hero-copy">
            <h1>Your whole workplace, in one place.</h1>
            <p>
              Channels, direct messages, teams and presence — everything your
              team needs to stay in sync, in real time.
            </p>

            <div className="auth-hero-chat">
              <div className="auth-chat-grid">
                <div className="auth-chat-side">
                  <span className="auth-chat-pill active"># general</span>
                  <span className="auth-chat-pill"># announcements</span>
                  <span className="auth-chat-pill"># design</span>
                  <span className="auth-chat-pill"># engineering</span>
                </div>
                <div className="auth-chat-main">
                  <div className="auth-chat-header">
                    <span># general</span>
                    <span>🟢 24 online</span>
                  </div>
                  <div className="auth-chat-msg">
                    <span className="auth-avatar g1">MC</span>
                    <div className="auth-chat-bubble">
                      <b>Maya</b>
                      <p>Dashboard improvements shipped 🚀</p>
                    </div>
                  </div>
                  <div className="auth-chat-msg own">
                    <div className="auth-chat-bubble">
                      <b>You</b>
                      <p>Nice! Reviewing the PR now 👀</p>
                    </div>
                  </div>
                  <div className="auth-chat-msg">
                    <span className="auth-avatar g2">DS</span>
                    <div className="auth-chat-bubble">
                      <b>Dara</b>
                      <p>Design review moved to 2 PM ✍️</p>
                    </div>
                  </div>
                  <div className="auth-chat-composer">
                    <Icon name="plus" size={14} />
                    <span>Type a message…</span>
                    <span className="send" aria-hidden="true"><Icon name="send" size={13} /></span>
                  </div>
                </div>
              </div>
            </div>

            <span className="auth-float-chip chip-a"><Icon name="message" size={14} /> 1.2k messages a day</span>
            <span className="auth-float-chip chip-b">⚡ Realtime, always on</span>
          </div>

          <div className="auth-hero-stats">
            <div><b>2,400+</b><span>teams onboard</span></div>
            <div><b>99.9%</b><span>uptime</span></div>
            <div><b>4.8★</b><span>average rating</span></div>
          </div>
        </div>
      </aside>

      {/* ------------------------------ Card ------------------------------ */}
      <main className="auth-side">
        <button
          className="theme-toggle auth-theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle dark mode"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>

        <div className="auth-card">
          <div className="auth-logo">
            <span className="brand-mark">k</span>
            <b>KneaChat</b>
          </div>

          <h2>{isRegistering ? 'Create your account' : 'Welcome back'}</h2>
          <p className="auth-sub">
            {isRegistering
              ? 'Join your workplace in seconds — it takes less than a minute.'
              : 'Sign in to your workspace to continue.'}
          </p>

          {maintenanceOn && (
            <div className="auth-notice">
              ⚠️ KneaChat is under maintenance. Only platform administrators can
              sign in right now.
            </div>
          )}
          {registrationClosed && !isRegistering && (
            <div className="auth-notice">
              Public registration is disabled — ask your workspace administrator
              to create your account.
            </div>
          )}
          {error && <div className="auth-error">{error}</div>}

          {!isRegistering && (
            <>
              <div className="auth-social">
                <button type="button" className="auth-social-btn" onClick={handleSocial}>
                  <GoogleIcon /> Google
                </button>
                <button type="button" className="auth-social-btn" onClick={handleSocial}>
                  <GithubIcon /> GitHub
                </button>
              </div>
              <div className="auth-divider">or continue with email</div>
            </>
          )}

          <form onSubmit={handleSubmit} noValidate>
            {isRegistering && (
              <div className="auth-2col">
                <Field
                  name="firstName"
                  label="First name"
                  icon={<UserIcon />}
                  value={firstName}
                  placeholder="Alex"
                  autoComplete="given-name"
                  autoFocus
                  error={errors.firstName}
                  valid={submitted && !!firstName && !errors.firstName}
                  onChange={(e) => update('firstName', e.target.value)}
                  onBlur={handleBlur('firstName')}
                />
                <Field
                  name="lastName"
                  label="Last name"
                  icon={<UserIcon />}
                  value={lastName}
                  placeholder="Nguyen"
                  autoComplete="family-name"
                  error={errors.lastName}
                  valid={submitted && !!lastName && !errors.lastName}
                  onChange={(e) => update('lastName', e.target.value)}
                  onBlur={handleBlur('lastName')}
                />
              </div>
            )}

            <Field
              name="email"
              label="Email address"
              icon={<EmailIcon />}
              type="email"
              value={email}
              placeholder="you@company.com"
              autoComplete="email"
              autoFocus={!isRegistering}
              error={errors.email}
              valid={submitted && !!email && !errors.email}
              onChange={(e) => update('email', e.target.value)}
              onBlur={handleBlur('email')}
            />

            <Field
              name="password"
              label="Password"
              icon={<LockIcon />}
              type={showPassword ? 'text' : 'password'}
              value={password}
              placeholder={isRegistering ? `At least ${minPasswordLength} characters` : 'Enter your password'}
              autoComplete={isRegistering ? 'new-password' : 'current-password'}
              error={errors.password}
              valid={submitted && !!password && !errors.password}
              showToggle
              showPassword={showPassword}
              onTogglePassword={() => setShowPassword((v) => !v)}
              onChange={(e) => update('password', e.target.value)}
              onBlur={handleBlur('password')}
            >
              {isRegistering && password && (
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
            </Field>

            {isRegistering && (
              <Field
                name="confirmPassword"
                label="Confirm password"
                icon={<LockIcon />}
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                placeholder="Repeat the password"
                autoComplete="new-password"
                error={errors.confirmPassword}
                valid={submitted && !!confirmPassword && !errors.confirmPassword}
                showToggle
                showPassword={showPassword}
                onTogglePassword={() => setShowPassword((v) => !v)}
                onChange={(e) => update('confirmPassword', e.target.value)}
                onBlur={handleBlur('confirmPassword')}
              />
            )}

            <button type="submit" disabled={loading} className="auth-btn">
              {loading ? (
                <>
                  <span className="auth-spinner" aria-hidden="true" />
                  {isRegistering ? 'Creating account…' : 'Signing in…'}
                </>
              ) : isRegistering ? (
                'Create account'
              ) : (
                'Sign in'
              )}
            </button>

            <div className="auth-foot">
              {!registrationClosed && (
                <button type="button" className="auth-link" onClick={toggleRegister}>
                  {isRegistering ? 'Already have an account?' : 'New here? Create an account'}
                </button>
              )}
              {!isRegistering && (
                <Link to="/forgot-password" className="auth-link">
                  Forgot password?
                </Link>
              )}
            </div>
          </form>

          {!isRegistering && (
            <div className="auth-demo">
              <p>Try a demo account</p>
              <div className="auth-demo-btns">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    className="auth-demo-btn"
                    disabled={loading}
                    onClick={() => {
                      clearError();
                      setEmail(account.email);
                      setPassword(account.password);
                      login({ email: account.email, password: account.password }).then((result) => {
                        if (result.success) navigate(from, { replace: true });
                      });
                    }}
                  >
                    {account.label}
                    <small>{account.sub}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Login;
