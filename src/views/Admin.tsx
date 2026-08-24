import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { ChannelModel, DepartmentModel, TeamModel, UserModel } from '../models';
import Avatar from '../components/common/Avatar';
import ConfirmButton from '../components/common/ConfirmButton';
import Icon from '../components/common/Icon';
import type { IconName } from '../components/common/Icon';
import { SkeletonTable } from '../components/common/Skeleton';
import { roleLabel } from '../utils/roles';
import type { Channel, Department, Team, User } from '../models';

type Tab = 'dashboard' | 'users' | 'teams' | 'channels' | 'departments';

/** Roles a company admin may assign. Super admins can also assign super_admin. */
const COMPANY_ROLES = ['admin', 'manager', 'employee'];

const getCurrentUser = (): { id: number | null; role: string } | null => {
  try {
    const stored = localStorage.getItem('kneachat_user');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
};

const getCurrentAdminId = (): number | null => getCurrentUser()?.id ?? null;

const getCurrentRole = (): string => getCurrentUser()?.role || 'employee';

const roleOptionsFor = (currentRole: string) =>
  currentRole === 'super_admin'
    ? ['super_admin', ...COMPANY_ROLES]
    : COMPANY_ROLES;

const Admin = () => {
  const { user, isAuthenticated, logout } = useAuthStore();
  const [tab, setTab] = useState<Tab>('dashboard');

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== 'admin' && user?.role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-soft">
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

      <main className="max-w-6xl mx-auto py-8 px-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-ink tracking-tight mb-1">Workspace Dashboard</h1>
            <p className="text-muted text-sm">Acme Corp HQ • Admin Console</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary"><Icon name="plus" size={13} /> Add New User</button>
            <button className="btn-broadcast"><Icon name="megaphone" size={14} /> Broadcast</button>
          </div>
        </div>

        {tab === 'dashboard' && <DashboardView onNavigate={setTab} />}
        {tab === 'users' && <UsersTab />}
        {tab === 'teams' && <TeamsTab />}
        {tab === 'channels' && <ChannelsTab />}
        {tab === 'departments' && <DepartmentsTab />}

        <div className="flex gap-2 mt-8 mb-6">
          {(['dashboard', 'users', 'teams', 'channels', 'departments'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`admin-tab ${tab === t ? 'active' : ''}`}
            >
              {t === 'dashboard' ? 'Dashboard' : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </main>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Dashboard overview                                                         */
/* -------------------------------------------------------------------------- */
const DashboardView = ({ onNavigate }: { onNavigate: (tab: Tab) => void }) => {
  const [stats, setStats] = useState<{
    users: number;
    online: number;
    teams: number;
    channels: number;
    storageUsed: number;
    storageTotal: number;
  } | null>(null);

  const [chartData, setChartData] = useState<Array<{ day: string; messages: number; huddles: number }>>([]);
  const [activities, setActivities] = useState<Array<{ id: number; text: string; time: string }>>([]);
  const [alerts, setAlerts] = useState<Array<{ id: number; title: string; description: string; action?: string }>>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [u, t, c] = await Promise.all([
          UserModel.getAll({ limit: 200 }),
          TeamModel.getAll(),
          ChannelModel.getAll(),
        ]);
        if (!mounted) return;
        const users = u.data.data?.users || [];
        setStats({
          users: users.length,
          online: users.filter((x) => x.status === 'online').length,
          teams: t.data.data?.teams?.length || 0,
          channels: c.data.data?.channels?.length || 0,
          storageUsed: 8.4,
          storageTotal: 10,
        });
        setChartData([
          { day: 'Mon', messages: 3.5, huddles: 0.8 },
          { day: 'Tue', messages: 4.8, huddles: 1.2 },
          { day: 'Wed', messages: 4.2, huddles: 0.9 },
          { day: 'Thu', messages: 5.6, huddles: 1.5 },
          { day: 'Fri', messages: 3.2, huddles: 0.6 },
        ]);
        setActivities([
          { id: 1, text: 'Sarah Chen updated permissions for #engineering-leads', time: '2 mins ago' },
          { id: 2, text: 'System automatically rotated API keys for GitHub Bot Integration', time: '1 hour ago' },
          { id: 3, text: 'Marcus Johnson added a new custom emoji pack /holiday-2024', time: '3 hours ago' },
        ]);
        setAlerts([
          { id: 1, title: 'Storage Limit Warning', description: 'Workspace storage has reached 85% capacity. Consider archiving old channels.', action: 'Review Storage Plans' },
          { id: 2, title: '12 New User Requests', description: "Pending approvals for the 'Engineering Contractors' group.", action: 'Review Requests' },
          { id: 3, title: 'Security Patch Available', description: 'SSO Integration requires an update to maintain compliance.', action: 'Apply Update' },
        ]);
      } catch {
        if (mounted) setStats({ users: 0, online: 0, teams: 0, channels: 0, storageUsed: 0, storageTotal: 10 });
      }
      return () => {
        mounted = false;
      };
    })();
  }, []);

  const maxChart = Math.max(...(chartData.map((d) => d.messages + d.huddles)));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="Total Users" value={stats ? stats.users.toLocaleString() : '—'} sub="+12% this month" icon="users" trend />
          <StatCard label="Active Now" value={stats ? stats.online.toLocaleString() : '—'} sub="Peak at 10:00 AM" icon="bolt" />
          <StatCard label="Storage" value={stats ? `${stats.storageUsed} TB` : '—'} sub={`${stats ? Math.round((stats.storageUsed / stats.storageTotal) * 100) : 0}%`} icon="archive" />
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-line overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-line">
            <h3 className="text-sm font-bold text-ink">User Engagement Pulse</h3>
            <select className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-lavender bg-white">
              <option>Last 7 Days</option>
              <option>Last 30 Days</option>
            </select>
          </div>
          <div className="px-6 py-6">
            {chartData.length === 0 ? (
              <div className="text-muted text-sm">Loading chart…</div>
            ) : (
              <div className="flex items-end gap-3 h-48">
                {chartData.map((d) => {
                  const total = d.messages + d.huddles;
                  const heightPct = maxChart > 0 ? (total / maxChart) * 100 : 0;
                  return (
                    <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
                      <div className="w-full flex flex-col items-center">
                        <div className="w-full max-w-[40px] rounded-t-lg bg-blue-500 relative" style={{ height: `${heightPct * 0.7}%`, minHeight: 8 }}>
                          <div className="absolute inset-x-0 bottom-0 rounded-t-lg bg-teal-200" style={{ height: '25%' }} />
                        </div>
                      </div>
                      <span className="text-[11px] text-muted">{d.day}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-4 mt-4 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Messages</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-teal-200" /> Huddles</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-line overflow-hidden">
          <div className="px-6 py-4 border-b border-line flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">Recent Administrative Activity</h3>
            <button className="text-xs text-lavender font-semibold hover:underline">View Full Audit Log →</button>
          </div>
          <div className="divide-y divide-line">
            {activities.map((a) => (
              <div key={a.id} className="px-6 py-3 flex items-center gap-3">
                <div className="flex-1 text-sm text-ink">{a.text}</div>
                <div className="text-xs text-muted whitespace-nowrap">{a.time}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-line overflow-hidden">
          <div className="px-6 py-4 border-b border-line">
            <h3 className="text-sm font-bold text-ink">Quick Actions</h3>
          </div>
          <div className="p-4 space-y-3">
            <button onClick={() => onNavigate('channels')} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl border border-line hover:bg-soft transition-colors text-left">
              <span className="text-lg"><Icon name="message" size={18} /></span>
              <div>
                <div className="text-sm font-semibold text-ink">Create Channel</div>
                <div className="text-xs text-muted">Setup new workspace area</div>
              </div>
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-xl border border-line hover:bg-soft transition-colors text-left">
              <span className="text-lg">📥</span>
              <div>
                <div className="text-sm font-semibold text-ink">Export Logs</div>
                <div className="text-xs text-muted">Download audit reports</div>
              </div>
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-line overflow-hidden">
          <div className="px-6 py-4 border-b border-line flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">System Alerts</h3>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">3 Needs Action</span>
          </div>
          <div className="p-4 space-y-3">
            {alerts.map((alert) => (
              <div key={alert.id} className="p-3 rounded-xl border border-line bg-soft">
                <div className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5">⚠️</span>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-ink">{alert.title}</div>
                    <div className="text-xs text-muted mt-1">{alert.description}</div>
                    {alert.action && (
                      <button className="mt-2 text-xs text-lavender font-semibold hover:underline">{alert.action}</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, sub, icon, trend }: { label: string; value: string; sub: string; icon: IconName; trend?: boolean }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-line p-5 transition-transform hover:-translate-y-0.5">
    <div className="flex items-center gap-2 text-muted mb-3">
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-soft"><Icon name={icon} size={15} /></span>
      <span className="text-[11px] font-bold uppercase tracking-wide">{label}</span>
      {trend && <span className="ml-auto text-[11px] text-emerald-600 font-semibold">↗</span>}
    </div>
    <div className="text-2xl font-bold text-ink tracking-tight">{value}</div>
    <div className="text-xs text-muted mt-1">{sub}</div>
    {label === 'Storage' && (
      <div className="mt-3 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full bg-red-500" style={{ width: '85%' }} />
      </div>
    )}
  </div>
);

/* -------------------------------------------------------------------------- */
/* Users tab                                                                  */
/* -------------------------------------------------------------------------- */
const UsersTab = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    role: 'employee',
    job_title: '',
    department_id: null as number | null,
  });
  const currentAdminId = getCurrentAdminId();
  const currentUserRole = getCurrentRole();
  const isSuperAdmin = currentUserRole === 'super_admin';
  const roleOptions = roleOptionsFor(currentUserRole);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userRes, deptRes] = await Promise.all([
        UserModel.getAll({ limit: 200 }),
        DepartmentModel.getAll(),
      ]);
      setUsers(userRes.data.data.users || []);
      setDepartments(deptRes.data.data.departments || []);
    } catch {
      setUsers([]);
      setDepartments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (fn: (e?: React.MouseEvent | React.ChangeEvent<HTMLSelectElement>) => Promise<void>) => async (e?: React.MouseEvent | React.ChangeEvent<HTMLSelectElement>) => {
    setError(null);
    setMessage(null);
    try {
      await fn(e);
      setMessage('Saved ✓');
      setTimeout(() => setMessage(null), 2000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Action failed');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await UserModel.create({
        ...newUser,
        department_id: newUser.department_id,
      });
      setNewUser({ first_name: '', last_name: '', email: '', password: '', role: 'employee', job_title: '', department_id: null });
      setShowCreate(false);
      setMessage('User created ✓');
      setTimeout(() => setMessage(null), 2000);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not create user');
    }
  };

  const inputCls =
    'w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lavender/40 focus:border-lavender text-sm';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-line overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-line">
        <h2 className="text-lg font-bold text-ink m-0">
          Users <span className="text-muted font-normal text-sm">({users.length})</span>
        </h2>
        <button className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Cancel' : (<><Icon name="plus" size={13} /> Add user</>)}
        </button>
      </div>

      {error && <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      {message && <div className="mx-6 mt-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{message}</div>}

      {showCreate && (
        <form onSubmit={handleCreate} className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-4 bg-soft border-b border-line">
          <input className={inputCls} placeholder="First name" required value={newUser.first_name} onChange={(e) => setNewUser({ ...newUser, first_name: e.target.value })} />
          <input className={inputCls} placeholder="Last name" required value={newUser.last_name} onChange={(e) => setNewUser({ ...newUser, last_name: e.target.value })} />
          <input className={inputCls} placeholder="Email" type="email" required value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
          <input className={inputCls} placeholder="Password" type="password" required value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
          <select className={inputCls} value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
            {roleOptions.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
          <select
            className={inputCls}
            value={newUser.department_id ?? ''}
            onChange={(e) => setNewUser({ ...newUser, department_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">No department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button type="submit" className="btn-primary">Create</button>
        </form>
      )}

      {loading ? (
        <SkeletonTable rows={6} cells={4} />
      ) : users.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon"><Icon name="users" size={18} /></span>
          No users yet — use “Add user” above to invite your first teammate.
        </div>
      ) : (
      <table className="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Department</th>
            <th>Status</th>
            <th>State</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="font-semibold">
                <span className="flex items-center gap-2">
                  <Avatar person={u} className="small" />
                  <span>{u.first_name} {u.last_name}</span>
                </span>
              </td>
              <td className="text-muted">{u.email}</td>
              <td>
                <select
                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-lavender"
                  value={u.role}
                  disabled={u.id === currentAdminId || (u.role === 'super_admin' && !isSuperAdmin)}
                  onChange={flash(async (e) => {
                    const el = e as React.ChangeEvent<HTMLSelectElement>;
                    await UserModel.update(u.id, { role: el.target.value as User['role'] });
                    await load();
                  })}
                >
                  {roleOptions.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </select>
              </td>
              <td className="text-muted">
                {departments.find((d) => d.id === u.department_id)?.name || '—'}
              </td>
              <td>
                <span className={`status-pill ${u.status || 'offline'}`}>{u.status || 'offline'}</span>
              </td>
              <td>
                <span className={`status-pill ${u.is_active ? 'active' : 'disabled'}`}>
                  {u.is_active ? 'Active' : 'Disabled'}
                </span>
              </td>
              <td>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary !py-1 !px-2 !text-xs"
                    disabled={u.id === currentAdminId || (u.role === 'super_admin' && !isSuperAdmin)}
                    onClick={flash(async () => {
                      await UserModel.update(u.id, { is_active: u.is_active ? 0 : 1 });
                      await load();
                    })}
                  >
                    {u.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <ConfirmButton
                    label="Delete"
                    className="btn-danger !py-1 !px-2 !text-xs"
                    disabled={u.id === currentAdminId || (u.role === 'super_admin' && !isSuperAdmin)}
                    onConfirm={flash(async () => {
                      await UserModel.remove(u.id);
                      await load();
                    })}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Teams tab                                                                  */
/* -------------------------------------------------------------------------- */
const TeamsTab = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTeam, setNewTeam] = useState({ name: '', description: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, userRes] = await Promise.all([
        TeamModel.getAll(),
        UserModel.getAll({ limit: 200 }),
      ]);
      setTeams(teamRes.data.data.teams || []);
      setUsers(userRes.data.data.users || []);
    } catch {
      setTeams([]);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await TeamModel.create(newTeam);
      setNewTeam({ name: '', description: '' });
      setShowCreate(false);
      setMessage('Team created ✓');
      setTimeout(() => setMessage(null), 2000);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not create team');
    }
  };

  const inputCls =
    'w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lavender/40 focus:border-lavender text-sm';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-line overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-line">
        <h2 className="text-lg font-bold text-ink m-0">
          Teams <span className="text-muted font-normal text-sm">({teams.length})</span>
        </h2>
        <button className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Cancel' : (<><Icon name="plus" size={13} /> Add team</>)}
        </button>
      </div>

      {error && <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      {message && <div className="mx-6 mt-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{message}</div>}

      {showCreate && (
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-3 px-6 py-4 bg-soft border-b border-line">
          <input className={inputCls} placeholder="Team name" required value={newTeam.name} onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })} />
          <input className={inputCls} placeholder="Description" value={newTeam.description} onChange={(e) => setNewTeam({ ...newTeam, description: e.target.value })} />
          <button type="submit" className="btn-primary">Create</button>
        </form>
      )}

      {loading ? (
        <SkeletonTable rows={4} cells={3} />
      ) : teams.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon"><Icon name="grid" size={18} /></span>
          No teams yet — use "Add team" above to organize your workspace.
        </div>
      ) : (
        <div className="px-6 py-4">
          <div className="team-card-grid">
            {teams.map((t) => (
              <div key={t.id} className="team-card admin-team-card">
                <div className="team-card-header">
                  <span className="team-card-icon">
                    <Icon name="grid" size={16} />
                  </span>
                  <span className="team-card-name">{t.name}</span>
                </div>
                {t.description && (
                  <p className="team-card-desc">{t.description}</p>
                )}
                <div className="team-card-meta">
                  <span>
                    <Icon name="users" size={13} /> {t.member_count ?? 0} members
                  </span>
                  <span className="text-muted">
                    Manager: {t.manager_first_name ? `${t.manager_first_name} ${t.manager_last_name}` : '—'}
                  </span>
                </div>
                <div className="flex gap-2 mt-3">
                  <ConfirmButton
                    label="Delete"
                    className="btn-danger !py-1 !px-2 !text-xs"
                    onConfirm={async () => {
                      try {
                        await TeamModel.remove(t.id);
                        setMessage('Team deleted');
                        setTimeout(() => setMessage(null), 2000);
                        await load();
                      } catch (err: any) {
                        setError(err.response?.data?.message || 'Could not delete team');
                      }
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-6 py-4 border-t border-line">
        <h3 className="text-sm font-bold text-ink mb-3">Add members to a team</h3>
        <MemberAdder
          teams={teams}
          users={users}
          getMembers={(teamId) => TeamModel.getMembers(teamId)}
          addMember={(teamId, userId) => TeamModel.addMember(teamId, userId)}
          removeMember={(teamId, userId) => TeamModel.removeMember(teamId, userId)}
          onChanged={load}
          onError={setError}
        />
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Channels tab                                                               */
/* -------------------------------------------------------------------------- */
const ChannelsTab = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newChannel, setNewChannel] = useState({
    name: '',
    description: '',
    type: 'public',
    team_id: null as number | null,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [chanRes, teamRes, userRes] = await Promise.all([
        ChannelModel.getAll(),
        TeamModel.getAll(),
        UserModel.getAll({ limit: 200 }),
      ]);
      setChannels(chanRes.data.data.channels || []);
      setTeams(teamRes.data.data.teams || []);
      setUsers(userRes.data.data.users || []);
    } catch {
      setChannels([]);
      setTeams([]);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await ChannelModel.create({
        name: newChannel.name.trim().toLowerCase().replace(/\s+/g, '-'),
        description: newChannel.description,
        type: newChannel.type as 'public' | 'private',
        team_id: newChannel.team_id,
      });
      setNewChannel({ name: '', description: '', type: 'public', team_id: null });
      setShowCreate(false);
      setMessage('Channel created ✓');
      setTimeout(() => setMessage(null), 2000);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not create channel');
    }
  };

  const inputCls =
    'w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lavender/40 focus:border-lavender text-sm';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-line overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-line">
        <h2 className="text-lg font-bold text-ink m-0">
          Channels <span className="text-muted font-normal text-sm">({channels.length})</span>
        </h2>
        <button className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Cancel' : (<><Icon name="plus" size={13} /> Add channel</>)}
        </button>
      </div>

      {error && <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      {message && <div className="mx-6 mt-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{message}</div>}

      {showCreate && (
        <form onSubmit={handleCreate} className="grid grid-cols-2 md:grid-cols-6 gap-3 px-6 py-4 bg-soft border-b border-line">
          <input className={inputCls} placeholder="Name (e.g. design)" required value={newChannel.name} onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })} />
          <input className={inputCls} placeholder="Description" value={newChannel.description} onChange={(e) => setNewChannel({ ...newChannel, description: e.target.value })} />
          <select className={inputCls} value={newChannel.type} onChange={(e) => setNewChannel({ ...newChannel, type: e.target.value })}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
          <select className={inputCls} value={newChannel.team_id ?? ''} onChange={(e) => setNewChannel({ ...newChannel, team_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">No team</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button type="submit" className="btn-primary">Create</button>
        </form>
      )}

      {loading ? (
        <SkeletonTable rows={5} cells={4} />
      ) : channels.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">#</span>
          No channels yet — use "Add channel" above to get conversations going.
        </div>
      ) : (
        <div className="px-6 py-4">
          <div className="channel-card-grid">
            {channels.map((c) => (
              <div key={c.id} className="channel-card admin-channel-card">
                <div className="channel-card-header">
                  <span className="channel-card-icon">
                    <Icon name="hash" size={16} />
                  </span>
                  <span className="channel-card-name">#{c.name}</span>
                </div>
                {c.description && (
                  <p className="channel-card-desc">{c.description}</p>
                )}
                <div className="channel-card-meta">
                  <span className={`status-pill ${c.type}`}>{c.type}</span>
                  <span className="channel-card-members">
                    <Icon name="users" size={13} /> {c.member_count ?? 0}
                  </span>
                  <span className={`status-pill ${c.is_archived ? 'disabled' : 'active'}`}>
                    {c.is_archived ? 'Archived' : 'Active'}
                  </span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    className="btn-secondary !py-1 !px-2 !text-xs"
                    onClick={async () => {
                      try {
                        await ChannelModel.update(c.id, { is_archived: c.is_archived ? 0 : 1 });
                        setMessage(c.is_archived ? 'Channel restored' : 'Channel archived');
                        setTimeout(() => setMessage(null), 2000);
                        await load();
                      } catch (err: any) {
                        setError(err.response?.data?.message || 'Action failed');
                      }
                    }}
                  >
                    {c.is_archived ? 'Restore' : 'Archive'}
                  </button>
                  <ConfirmButton
                    label="Delete"
                    className="btn-danger !py-1 !px-2 !text-xs"
                    onConfirm={async () => {
                      try {
                        await ChannelModel.remove(c.id);
                        setMessage('Channel deleted');
                        setTimeout(() => setMessage(null), 2000);
                        await load();
                      } catch (err: any) {
                        setError(err.response?.data?.message || 'Could not delete channel');
                      }
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-6 py-4 border-t border-line">
        <h3 className="text-sm font-bold text-ink mb-3">Add members to a channel</h3>
        <MemberAdder
          teams={[]}
          channels={channels}
          users={users}
          getMembers={(channelId) => ChannelModel.getMembers(channelId)}
          addMember={(channelId, userId) => ChannelModel.addMember(channelId, userId)}
          removeMember={(channelId, userId) => ChannelModel.removeMember(channelId, userId)}
          onChanged={load}
          onError={setError}
        />
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Departments tab                                                            */
/* -------------------------------------------------------------------------- */
const DepartmentsTab = () => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newDepartment, setNewDepartment] = useState({ name: '', description: '' });
  const [editing, setEditing] = useState<Department | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await DepartmentModel.getAll();
      setDepartments(res.data.data.departments || []);
    } catch {
      setDepartments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await DepartmentModel.create(newDepartment);
      setNewDepartment({ name: '', description: '' });
      setShowCreate(false);
      setMessage('Department created ✓');
      setTimeout(() => setMessage(null), 2000);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not create department');
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    setMessage(null);
    try {
      await DepartmentModel.update(editing.id, {
        name: editForm.name,
        description: editForm.description || undefined,
      });
      setEditing(null);
      setMessage('Department updated ✓');
      setTimeout(() => setMessage(null), 2000);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not update department');
    }
  };

  const inputCls =
    'w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lavender/40 focus:border-lavender text-sm';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-line overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-line">
        <h2 className="text-lg font-bold text-ink m-0">
          Departments <span className="text-muted font-normal text-sm">({departments.length})</span>
        </h2>
        <button className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Cancel' : (<><Icon name="plus" size={13} /> Add department</>)}
        </button>
      </div>

      {error && <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      {message && <div className="mx-6 mt-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{message}</div>}

      {showCreate && (
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-3 px-6 py-4 bg-soft border-b border-line">
          <input className={inputCls} placeholder="Department name" required value={newDepartment.name} onChange={(e) => setNewDepartment({ ...newDepartment, name: e.target.value })} />
          <input className={inputCls} placeholder="Description" value={newDepartment.description} onChange={(e) => setNewDepartment({ ...newDepartment, description: e.target.value })} />
          <button type="submit" className="btn-primary">Create</button>
        </form>
      )}

      {editing && (
        <form onSubmit={handleEditSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3 px-6 py-4 bg-soft border-b border-line">
          <input className={inputCls} placeholder="Department name" required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          <input className={inputCls} placeholder="Description" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary">Save</button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonTable rows={4} cells={3} />
      ) : departments.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon"><Icon name="grid" size={18} /></span>
          No departments yet — use “Add department” above to organize your workspace.
        </div>
      ) : (
      <table className="admin-table">
        <thead>
          <tr><th>Department</th><th>Members</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {departments.map((d) => (
            <tr key={d.id}>
              <td className="font-semibold">{d.name}
                {d.description && <div className="text-muted text-xs font-normal">{d.description}</div>}
              </td>
              <td className="text-muted">{d.user_count ?? 0}</td>
              <td>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary !py-1 !px-2 !text-xs"
                    onClick={() => {
                      setEditing(d);
                      setEditForm({ name: d.name, description: d.description || '' });
                    }}
                  >
                    Edit
                  </button>
                  <ConfirmButton
                    label="Delete"
                    className="btn-danger !py-1 !px-2 !text-xs"
                    onConfirm={async () => {
                      try {
                        await DepartmentModel.remove(d.id);
                        setMessage('Department deleted ✓');
                        setTimeout(() => setMessage(null), 2000);
                        await load();
                      } catch (err: any) {
                        setError(err.response?.data?.message || 'Could not delete department');
                      }
                    }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}

      <p className="px-6 py-4 border-t border-line text-xs text-muted">
        Departments group employees and teams (SRS FR-06). A department that still has
        members cannot be deleted — reassign its members first.
      </p>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Shared member adder                                                        */
/* -------------------------------------------------------------------------- */
interface MemberAdderProps {
  teams?: Team[];
  channels?: Channel[];
  users: User[];
  getMembers: (id: number) => Promise<{ data: { data: { members: User[] } } }>;
  addMember: (id: number, userId: number) => Promise<unknown>;
  removeMember: (id: number, userId: number) => Promise<unknown>;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}

const MemberAdder = ({
  teams = [],
  channels = [],
  users,
  getMembers,
  addMember,
  removeMember,
  onChanged,
  onError,
}: MemberAdderProps) => {
  const [targetId, setTargetId] = useState<number | ''>('');
  const [members, setMembers] = useState<User[]>([]);
  const [addUserId, setAddUserId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);

  const targets: Array<{ id: number; label: string }> = [
    ...teams.map((t) => ({ id: t.id, label: `Team: ${t.name}` })),
    ...channels.map((c) => ({ id: c.id, label: `#${c.name}` })),
  ];

  const loadMembers = async (id: number) => {
    try {
      const res = await getMembers(id);
      setMembers(res.data.data.members || []);
    } catch {
      setMembers([]);
    }
  };

  const handleTargetChange = async (id: number | '') => {
    setTargetId(id);
    setAddUserId('');
    if (id !== '') await loadMembers(id);
    else setMembers([]);
  };

  const addable = users.filter((u) => !members.some((m) => m.id === u.id));

  const handleAdd = async () => {
    if (targetId === '' || addUserId === '') return;
    setBusy(true);
    try {
      await addMember(targetId, Number(addUserId));
      setAddUserId('');
      await loadMembers(targetId);
      await onChanged();
    } catch (err: any) {
      onError(err.response?.data?.message || 'Could not add member');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (userId: number) => {
    if (targetId === '') return;
    setBusy(true);
    try {
      await removeMember(targetId, userId);
      await loadMembers(targetId);
      await onChanged();
    } catch (err: any) {
      onError(err.response?.data?.message || 'Could not remove member');
    } finally {
      setBusy(false);
    }
  };

  if (targets.length === 0) {
    return <p className="text-muted text-sm">Nothing to manage yet.</p>;
  }

  return (
    <div>
      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-lavender"
          value={targetId}
          onChange={(e) => handleTargetChange(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">Pick a team or channel…</option>
          {targets.map((t) => <option key={t.label} value={t.id}>{t.label}</option>)}
        </select>
        {targetId !== '' && (
          <>
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-lavender"
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Add member…</option>
              {addable.map((u) => (
                <option key={u.id} value={u.id}>{u.first_name} {u.last_name} · {u.email}</option>
              ))}
            </select>
            <button className="btn-primary !py-2 !px-3 !text-xs" disabled={busy || addUserId === ''} onClick={handleAdd}>
              Add
            </button>
          </>
        )}
      </div>

      {targetId !== '' && (
        <ul className="modal-member-list">
          {members.length === 0 && <li className="text-muted text-sm">No members yet.</li>}
          {members.map((m) => (
            <li key={m.id}>
              <Avatar person={m} className="small" showStatus />
              <span className="flex-1">
                <b className="block text-[13px]">{m.first_name} {m.last_name}</b>
                <small className="text-muted block text-[11px]">{m.job_title || m.email}</small>
              </span>
              <button className="picker-remove" disabled={busy} onClick={() => handleRemove(m.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Admin;
