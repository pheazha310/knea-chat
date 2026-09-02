import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { CompanyModel, SystemSettingModel, UserModel, type SystemSettings } from '../models';
import Avatar from '../components/common/Avatar';
import ConfirmButton from '../components/common/ConfirmButton';
import { roleLabel } from '../utils/roles';
import { SkeletonTable } from '../components/common/Skeleton';
import Icon from '../components/common/Icon';
import type { IconName } from '../components/common/Icon';
import type { Company, User } from '../models';

type Tab = 'overview' | 'organizations' | 'admins' | 'settings';

/**
 * Platform Administration (Super Admin only).
 *
 * Super Admin permissions per the role matrix: manage organizations
 * (companies), administrators, and system settings.
 */
const SuperAdmin = () => {
  const { user, isAuthenticated, logout } = useAuthStore();
  const [tab, setTab] = useState<Tab>('overview');

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== 'super_admin') return <Navigate to="/dashboard" replace />;

  return (
    <div className="super-admin-page">
      <header className="topbar super-admin-topbar">
        <div className="brand">
          <span className="brand-mark">k</span>
          <span>KneaChat</span>
        </div>
        <label className="super-admin-search">
          <Icon name="search" size={14} /><input placeholder="Search global system…" aria-label="Search global system" />
        </label>
        <nav className="super-admin-topnav">
          <button className="super-admin-header-icon" aria-label="Notifications" title="Notifications"><Icon name="bell" size={16} /></button>
          <Link to="/profile" className="super-admin-header-icon" aria-label="Admin profile" title="Admin profile"><Icon name="user" size={16} /></Link>
          <span className="super-admin-header-divider" aria-hidden="true" />
          <Link to="/dashboard" className="topbar-link">
            <Icon name="arrow-left" size={14} /> Back to workspace
          </Link>
          <button onClick={logout} className="topbar-signout">
            Sign out
          </button>
        </nav>
      </header>

      <main className="super-admin-shell">
        <aside className="super-admin-sidebar">
          <div className="super-admin-sidebar-label">Platform</div>
          {([
            ['overview', 'home', 'Global Overview'],
            ['organizations', 'grid', 'Workspaces'],
            ['admins', 'users', 'Administrator Access'],
            ['settings', 'gear', 'Platform Settings'],
          ] as Array<[Tab, IconName, string]>).map(([id, icon, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`super-admin-nav-item ${tab === id ? 'active' : ''}`}
            >
              <span><Icon name={icon} size={15} /></span>{label}
            </button>
          ))}
          <div className="super-admin-sidebar-foot"><Avatar person={user} className="small" showStatus /><div><b>{user?.first_name} {user?.last_name}</b><small>{roleLabel(user?.role)}</small></div></div>
        </aside>

        <section className="super-admin-content">
          {tab === 'overview' && <OverviewTab onNavigate={setTab} />}
          {tab === 'organizations' && <OrganizationsTab />}
          {tab === 'admins' && <AdminsTab />}
          {tab === 'settings' && <SettingsTab />}
        </section>
      </main>
    </div>
  );
};

const OverviewTab = ({ onNavigate }: { onNavigate: (tab: Tab) => void }) => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  useEffect(() => {
    CompanyModel.getAll().then((res) => setCompanies(res.data.data.companies || [])).catch(() => setCompanies([]));
    SystemSettingModel.getAll().then((res) => setSettings(res.data.data.settings)).catch(() => setSettings(null));
  }, []);

  const users = companies.reduce((sum, company) => sum + (company.user_count || 0), 0);
  const admins = companies.reduce((sum, company) => sum + (company.admin_count || 0), 0);
  const teams = companies.reduce((sum, company) => sum + (company.team_count || 0), 0);
  const alerts = [
    settings?.maintenance_mode
      ? { title: 'Maintenance mode is enabled', body: 'Non-Super Admin access is currently limited.', critical: true }
      : { title: 'Platform access is available', body: 'Maintenance mode is currently off.', critical: false },
    settings && !settings.allow_public_registration
      ? { title: 'Public registration is disabled', body: 'New users must be created by an administrator.', critical: false }
      : { title: 'Public registration is enabled', body: 'Visitors can create an account when eligible.', critical: false },
  ];

  return <>
    <header className="command-center-heading">
      <div><span>Global overview</span><h1>System Command Center</h1><p>Platform health, workspace growth, and operational controls in one place.</p></div>
      <div className="command-center-actions"><button className="btn-primary" onClick={() => onNavigate('organizations')}><Icon name="plus" size={13} /> Provision workspace</button><button className="btn-secondary" onClick={() => onNavigate('settings')}><Icon name="gear" size={13} /> Platform settings</button></div>
    </header>
    <div className="command-kpis">
      <CommandKpi label="Total workspaces" value={companies.length} note={`${teams} teams across the platform`} icon="grid" />
      <CommandKpi label="Global users" value={users.toLocaleString()} note={`${admins} workspace administrators`} icon="users" />
      <CommandKpi label="Platform access" value={settings?.maintenance_mode ? 'Limited' : 'Available'} note={settings?.maintenance_mode ? 'Maintenance mode is active' : 'All services are enabled'} icon="bolt" warning={!!settings?.maintenance_mode} />
      <CommandKpi label="Registration" value={settings?.allow_public_registration ? 'Open' : 'Managed'} note={settings?.allow_public_registration ? 'Public sign-up allowed' : 'Admin-created accounts only'} icon="check" />
    </div>
    <div className="command-center-grid">
      <section className="command-card command-health"><div className="command-card-heading"><div><h2>Platform Health</h2><p>Live configuration and workspace indicators.</p></div><button onClick={() => onNavigate('settings')}>View settings →</button></div><div className="command-health-grid"><HealthMetric label="Workspace capacity" value={`${companies.length} organizations`} level="good" /><HealthMetric label="Team collaboration" value={`${teams} active teams`} level="good" /><HealthMetric label="Account access" value={settings?.maintenance_mode ? 'Restricted' : 'Operational'} level={settings?.maintenance_mode ? 'critical' : 'good'} /></div></section>
      <aside className="command-alerts"><h2>{settings?.maintenance_mode ? 'Critical Alerts' : 'System Notices'}</h2>{alerts.map((alert) => <div className={`command-alert ${alert.critical ? 'critical' : ''}`} key={alert.title}><i>{alert.critical ? '!' : '•'}</i><div><b>{alert.title}</b><p>{alert.body}</p></div></div>)}</aside>
    </div>
    <div className="command-bottom-grid"><section className="command-card command-directory"><div className="command-card-heading"><div><h2>Top Workspaces</h2><p>Your most established organizations.</p></div><button onClick={() => onNavigate('organizations')}>View directory →</button></div>{companies.length ? <table><thead><tr><th>Workspace</th><th>Users</th><th>Admins</th><th>Teams</th></tr></thead><tbody>{companies.slice(0, 4).map((company) => <tr key={company.id}><td><span className="command-company-mark">{company.name.charAt(0)}</span>{company.name}</td><td>{company.user_count || 0}</td><td>{company.admin_count || 0}</td><td><span className="status-pill active">{company.team_count || 0} active</span></td></tr>)}</tbody></table> : <div className="empty-state"><span className="empty-state-icon"><Icon name="grid" size={18} /></span>No workspaces yet. Provision your first workspace to get started.</div>}</section><section className="command-growth"><h2>Workspace Growth</h2><p>Current platform distribution</p><div className="command-growth-orbit"><b>{companies.length}</b><span>workspaces</span></div><div><span>Users</span><b>{users.toLocaleString()}</b></div><div><span>Teams</span><b>{teams}</b></div></section></div>
  </>;
};

const CommandKpi = ({ label, value, note, icon, warning = false }: { label: string; value: string | number; note: string; icon: IconName; warning?: boolean }) => <article className={`command-kpi ${warning ? 'warning' : ''}`}><span className="command-kpi-icon"><Icon name={icon} size={16} /></span><small>{label}</small><b>{value}</b><p>{note}</p></article>;
const HealthMetric = ({ label, value, level }: { label: string; value: string; level: 'good' | 'critical' }) => <article className="health-metric"><div><b>{label}</b><span className={level} /></div><strong>{value}</strong><i><em className={level} /></i></article>;

/* -------------------------------------------------------------------------- */
/* Organizations tab                                                          */
/* -------------------------------------------------------------------------- */
const OrganizationsTab = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newOrg, setNewOrg] = useState({ name: '', domain: '' });
  const [editing, setEditing] = useState<Company | null>(null);
  const [editForm, setEditForm] = useState({ name: '', domain: '' });
  const [search, setSearch] = useState('');
  // Expanded "manage administrators" panel per organization.
  const [manageOrgId, setManageOrgId] = useState<number | null>(null);
  const [admins, setAdmins] = useState<User[]>([]);
  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await CompanyModel.getAll({ search });
      setCompanies(res.data.data.companies || []);
    } catch {
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (fn: () => Promise<void>) => async () => {
    setError(null);
    setMessage(null);
    try {
      await fn();
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
      await CompanyModel.create({
        name: newOrg.name,
        domain: newOrg.domain || undefined,
      });
      setNewOrg({ name: '', domain: '' });
      setShowCreate(false);
      setMessage('Organization created ✓');
      setTimeout(() => setMessage(null), 2000);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not create organization');
    }
  };

  const openManage = async (org: Company) => {
    if (manageOrgId === org.id) {
      setManageOrgId(null);
      setAdmins([]);
      setOrgUsers([]);
      return;
    }
    setManageOrgId(org.id);
    setBusy(true);
    try {
      const [adminRes, userRes] = await Promise.all([
        CompanyModel.getAdmins(org.id),
        CompanyModel.getUsers(org.id),
      ]);
      setAdmins(adminRes.data.data.admins || []);
      setOrgUsers(userRes.data.data.users || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not load administrators');
    } finally {
      setBusy(false);
    }
  };

  const promoteToAdmin = async (userId: number) => {
    if (manageOrgId === null) return;
    setBusy(true);
    try {
      await UserModel.update(userId, { role: 'admin' });
      const [adminRes, userRes] = await Promise.all([
        CompanyModel.getAdmins(manageOrgId),
        CompanyModel.getUsers(manageOrgId),
      ]);
      setAdmins(adminRes.data.data.admins || []);
      setOrgUsers(userRes.data.data.users || []);
      setMessage('Administrator added ✓');
      setTimeout(() => setMessage(null), 2000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not update role');
    } finally {
      setBusy(false);
    }
  };

  const demoteAdmin = async (userId: number) => {
    if (manageOrgId === null) return;
    setBusy(true);
    try {
      await UserModel.update(userId, { role: 'employee' });
      const [adminRes, userRes] = await Promise.all([
        CompanyModel.getAdmins(manageOrgId),
        CompanyModel.getUsers(manageOrgId),
      ]);
      setAdmins(adminRes.data.data.admins || []);
      setOrgUsers(userRes.data.data.users || []);
      setMessage('Administrator removed ✓');
      setTimeout(() => setMessage(null), 2000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not update role');
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lavender/40 focus:border-lavender text-sm';

  const totalUsers = companies.reduce((sum, c) => sum + (c.user_count || 0), 0);
  const totalAdmins = companies.reduce((sum, c) => sum + (c.admin_count || 0), 0);

  return (
    <div>
      <div className="super-admin-stats">
        <StatCard label="Organizations" value={companies.length} sub="Across the platform" icon="grid" />
        <StatCard label="Total Users" value={totalUsers} sub="All organizations" icon="users" />
        <StatCard label="Administrators" value={totalAdmins} sub="Company admins" icon="user" />
      </div>

      <div className="super-admin-panel">
        <div className="super-admin-panel-header">
          <div>
            <h2>
              Organizations <span>({companies.length})</span>
            </h2>
            <p>Manage the workspaces connected to your platform.</p>
          </div>
          <div className="super-admin-panel-actions">
            <input
              className={inputCls + ' !w-56'}
              placeholder="Search name or domain…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
              {showCreate ? 'Cancel' : (<><Icon name="plus" size={13} /> Add organization</>)}
            </button>
          </div>
        </div>

        {error && <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
        {message && <div className="mx-6 mt-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{message}</div>}

        {showCreate && (
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-3 px-6 py-4 bg-soft border-b border-line">
            <input className={inputCls} placeholder="Organization name" required value={newOrg.name} onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })} />
            <input className={inputCls} placeholder="Domain (e.g. acme.com)" value={newOrg.domain} onChange={(e) => setNewOrg({ ...newOrg, domain: e.target.value })} />
            <button type="submit" className="btn-primary">Create</button>
          </form>
        )}

        {editing && (
          <form
            onSubmit={flash(async () => {
              await CompanyModel.update(editing.id, {
                name: editForm.name,
                domain: editForm.domain || undefined,
              });
              setEditing(null);
              await load();
            })}
            className="grid grid-cols-1 md:grid-cols-3 gap-3 px-6 py-4 bg-soft border-b border-line"
          >
            <input className={inputCls} placeholder="Organization name" required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            <input className={inputCls} placeholder="Domain" value={editForm.domain} onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })} />
            <div className="flex gap-2">
              <button type="submit" className="btn-primary">Save</button>
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        )}

        {loading ? (
          <SkeletonTable rows={4} cells={5} />
        ) : companies.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon"><Icon name="building" size={18} /></span>
            No organizations yet — use “Add organization” to onboard a new company.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Domain</th>
                  <th>Users</th>
                  <th>Admins</th>
                  <th>Teams</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
              {companies.map((c) => (
                <React.Fragment key={c.id}>
                  <tr>
                    <td className="font-semibold">{c.name}</td>
                    <td className="text-muted">{c.domain || '—'}</td>
                    <td className="text-muted">{c.user_count ?? 0}</td>
                    <td className="text-muted">{c.admin_count ?? 0}</td>
                    <td className="text-muted">{c.team_count ?? 0}</td>
                    <td>
                      <div className="flex gap-2">
                        <button
                          className="btn-secondary !py-1 !px-2 !text-xs"
                          onClick={() => openManage(c)}
                        >
                          {manageOrgId === c.id ? 'Close' : 'Manage admins'}
                        </button>
                        <button
                          className="btn-secondary !py-1 !px-2 !text-xs"
                          onClick={() => {
                            setEditing(c);
                            setEditForm({ name: c.name, domain: c.domain || '' });
                          }}
                        >
                          Edit
                        </button>
                        <ConfirmButton
                          label="Delete"
                          className="btn-danger !py-1 !px-2 !text-xs"
                          disabled={(c.user_count || 0) > 0 || (c.team_count || 0) > 0}
                          onConfirm={flash(async () => {
                            await CompanyModel.remove(c.id);
                            await load();
                          })}
                        />
                      </div>
                    </td>
                  </tr>
                  {manageOrgId === c.id && (
                    <tr>
                      <td colSpan={6} className="!bg-soft">
                        <div className="py-2">
                          <h3 className="text-sm font-bold text-ink mb-3">
                            Administrators of {c.name}
                          </h3>
                          {busy ? (
                            <p className="text-muted text-sm">Loading…</p>
                          ) : admins.length === 0 ? (
                            <p className="text-muted text-sm mb-3">
                              No administrators yet. Promote someone below.
                            </p>
                          ) : (
                            <ul className="modal-member-list mb-4">
                              {admins.map((a) => (
                                <li key={a.id}>
                                  <Avatar person={a} className="small" showStatus />
                                  <span className="flex-1">
                                    <b className="block text-[13px]">{a.first_name} {a.last_name}</b>
                                    <small className="text-muted block text-[11px]">{a.email}</small>
                                  </span>
                                  <button
                                    className="picker-remove"
                                    disabled={busy}
                                    onClick={() => demoteAdmin(a.id)}
                                  >
                                    Demote
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          <h4 className="text-xs font-bold uppercase tracking-wide text-muted mb-2">
                            Promote a member to administrator
                          </h4>
                          <PromotePicker
                            users={orgUsers.filter((u) => u.role !== 'admin')}
                            admins={admins}
                            onPromote={promoteToAdmin}
                            busy={busy}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const StatCard = ({ label, value, sub, icon }: { label: string; value: number; sub: string; icon: IconName }) => (
  <div className="super-admin-stat-card">
    <div className="super-admin-stat-label">
      <span className="super-admin-stat-icon"><Icon name={icon} size={15} /></span>
      <span>{label}</span>
    </div>
    <div className="super-admin-stat-value">{value.toLocaleString()}</div>
    <div className="super-admin-stat-sub">{sub}</div>
  </div>
);

const PromotePicker = ({
  users,
  admins,
  onPromote,
  busy,
}: {
  users: User[];
  admins: User[];
  onPromote: (userId: number) => Promise<void>;
  busy: boolean;
}) => {
  const [selected, setSelected] = useState<number | ''>('');

  const promote = async () => {
    if (selected === '') return;
    await onPromote(Number(selected));
    setSelected('');
  };

  const addable = users.filter((u) => !admins.some((a) => a.id === u.id));

  return (
    <div className="flex gap-3 flex-wrap">
      <select
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-lavender"
        value={selected}
        onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : '')}
      >
        <option value="">Pick a member…</option>
        {addable.map((u) => (
          <option key={u.id} value={u.id}>
            {u.first_name} {u.last_name} · {u.email}
          </option>
        ))}
      </select>
      <button
        className="btn-primary !py-2 !px-3 !text-xs"
        disabled={busy || selected === '' || addable.length === 0}
        onClick={promote}
      >
        Promote to admin
      </button>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Administrators tab                                                         */
/* -------------------------------------------------------------------------- */
const AdminsTab = () => {
  const [rows, setRows] = useState<Array<{ org: string; user: User }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const orgRes = await CompanyModel.getAll();
        const companies = orgRes.data.data.companies || [];
        const perOrg = await Promise.all(
          companies.map(async (c) => {
            try {
              const res = await CompanyModel.getAdmins(c.id);
              return (res.data.data.admins || []).map((user) => ({ org: c.name, user }));
            } catch {
              return [];
            }
          }),
        );
        if (mounted) setRows(perOrg.flat());
      } catch {
        if (mounted) setRows([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="super-admin-panel">
      <div className="super-admin-panel-header">
        <div>
          <h2>
            Administrators <span>({rows.length})</span>
          </h2>
          <p>People with elevated access in organization workspaces.</p>
        </div>
      </div>
      {loading ? (
        <SkeletonTable rows={5} cells={3} />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🛡️</span>
          No administrators yet — open an organization and promote a member.
        </div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Administrator</th>
              <th>Email</th>
              <th>Organization</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.user.id}-${i}`}>
                <td className="font-semibold">
                  <span className="flex items-center gap-2">
                    <Avatar person={r.user} className="small" />
                    <span>{r.user.first_name} {r.user.last_name}</span>
                  </span>
                </td>
                <td className="text-muted">{r.user.email}</td>
                <td className="text-muted">{r.org}</td>
                <td>
                  <span className={`status-pill ${r.user.is_active ? 'active' : 'disabled'}`}>
                    {r.user.is_active ? 'Active' : 'Disabled'}
                  </span>
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
/* System Settings tab                                                        */
/* -------------------------------------------------------------------------- */
const DEFAULTS: SystemSettings = {
  maintenance_mode: false,
  allow_public_registration: true,
  password_min_length: 6,
  max_upload_size_mb: 10,
  max_users_per_org: 0,
  allow_uploads: true,
  allow_reactions: true,
  allow_pinning: true,
};

const SettingsTab = () => {
  const [settings, setSettings] = useState<SystemSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await SystemSettingModel.getAll();
        if (mounted) setSettings(res.data.data.settings);
      } catch {
        if (mounted) setError('Could not load settings');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const setBool = (key: keyof SystemSettings) => (value: boolean) => {
    setSettings((s) => ({ ...s, [key]: value }));
  };

  const setNum = (key: keyof SystemSettings) => (value: string) => {
    const n = parseInt(value, 10);
    setSettings((s) => ({ ...s, [key]: Number.isFinite(n) ? n : 0 }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const res = await SystemSettingModel.update(settings);
      setSettings(res.data.data.settings);
      setMessage('Settings saved ✓');
      setTimeout(() => setMessage(null), 2000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave}>
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      {message && <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{message}</div>}

      {loading ? (
        <SkeletonTable rows={5} cells={2} />
      ) : (
        <div className="space-y-6">
          {settings.maintenance_mode && (
            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm">
              ⚠️ Maintenance mode is ON — only Super Admins can use the platform right now.
            </div>
          )}

          <section className="super-admin-panel super-admin-settings-card">
            <div className="px-6 py-4 border-b border-line">
              <h3 className="text-sm font-bold text-ink">Maintenance</h3>
              <p className="text-xs text-muted mt-1">
                Put the platform into maintenance. Everyone except Super Admins is blocked
                from signing in and using the API.
              </p>
            </div>
            <div className="p-6">
              <ToggleRow
                label="Maintenance mode"
                description="Block all non-Super Admin access during deployments or incidents."
                checked={settings.maintenance_mode}
                onChange={setBool('maintenance_mode')}
              />
            </div>
          </section>

          <section className="super-admin-panel super-admin-settings-card">
            <div className="px-6 py-4 border-b border-line">
              <h3 className="text-sm font-bold text-ink">Registration &amp; Security</h3>
              <p className="text-xs text-muted mt-1">
                Who can join, password strength, and workspace size limits.
              </p>
            </div>
            <div className="p-6 space-y-5">
              <ToggleRow
                label="Public registration"
                description="Allow anyone to create an account. When off, administrators must create accounts."
                checked={settings.allow_public_registration}
                onChange={setBool('allow_public_registration')}
              />
              <NumberRow
                label="Minimum password length"
                description="Enforced on registration and password changes."
                value={settings.password_min_length}
                onChange={setNum('password_min_length')}
                min={4}
                max={64}
              />
              <NumberRow
                label="Max users per organization"
                description="0 = unlimited. Enforced when administrators create users or people register."
                value={settings.max_users_per_org}
                onChange={setNum('max_users_per_org')}
                min={0}
              />
            </div>
          </section>

          <section className="super-admin-panel super-admin-settings-card">
            <div className="px-6 py-4 border-b border-line">
              <h3 className="text-sm font-bold text-ink">Messaging Features</h3>
              <p className="text-xs text-muted mt-1">
                Platform-wide feature toggles for the chat experience.
              </p>
            </div>
            <div className="p-6 space-y-5">
              <ToggleRow
                label="File uploads"
                description="Allow attaching files to messages."
                checked={settings.allow_uploads}
                onChange={setBool('allow_uploads')}
              />
              <NumberRow
                label="Max upload size (MB)"
                description="Largest file a user can attach to a message."
                value={settings.max_upload_size_mb}
                onChange={setNum('max_upload_size_mb')}
                min={1}
                max={100}
              />
              <ToggleRow
                label="Reactions"
                description="Allow emoji reactions on messages."
                checked={settings.allow_reactions}
                onChange={setBool('allow_reactions')}
              />
              <ToggleRow
                label="Message pinning"
                description="Allow pinning important messages to a conversation."
                checked={settings.allow_pinning}
                onChange={setBool('allow_pinning')}
              />
            </div>
          </section>

          <div className="flex justify-end">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      )}
    </form>
  );
};

const ToggleRow = ({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) => (
  <label className="super-admin-setting-row">
    <div>
      <div className="text-sm font-semibold text-ink">{label}</div>
      <div className="text-xs text-muted mt-0.5">{description}</div>
    </div>
    <span className="super-admin-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" />
    </span>
  </label>
);

const NumberRow = ({
  label,
  description,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (value: string) => void;
  min: number;
  max?: number;
}) => (
  <div className="super-admin-setting-row">
    <div>
      <div className="text-sm font-semibold text-ink">{label}</div>
      <div className="text-xs text-muted mt-0.5">{description}</div>
    </div>
    <input
      type="number"
      className="super-admin-number-input"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

export default SuperAdmin;
