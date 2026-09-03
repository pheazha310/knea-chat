import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { ChannelModel, DepartmentModel, TeamModel, UserModel } from '../models';
import ConfirmButton from '../components/common/ConfirmButton';
import Icon from '../components/common/Icon';
import type { IconName } from '../components/common/Icon';
import CreateTeamModal from '../components/modals/CreateTeamModal';
import TeamModal from '../components/modals/TeamModal';
import { SkeletonTable } from '../components/common/Skeleton';
import { roleLabel } from '../utils/roles';
import type { Channel, Department, Team, User } from '../models';
import ManagerAttendanceView from '../components/views/ManagerAttendanceView';

type ManageTab = 'teams' | 'attendance';

const MANAGER_ROLES = ['manager', 'admin', 'super_admin'];

/** Badge for the requester's standing inside a team. */
const TeamRoleBadge = ({ team, isManager, role }: { team: Team; isManager: boolean; role: string }) => {
  if (team.user_role) {
    return (
      <span className={`status-pill ${team.user_role === 'leader' ? 'active' : 'member'}`}>
        {team.user_role === 'leader' ? 'Leader' : 'Member'}
      </span>
    );
  }
  return isManager ? <span className="text-muted text-xs">—</span> : <span className="status-pill">{roleLabel(role)}</span>;
};

/**
 * Team Management console — dedicated management view for Managers.
 *
 * Managers see and manage only the teams they are assigned to (a member of),
 * matching the scoped server-side permissions. Admins & Super Admins inherit
 * the view and see every team in the company.
 */
const Manager = () => {
  const { user, isAuthenticated, logout } = useAuthStore();
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Team | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [viewingTeam, setViewingTeam] = useState<Team | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState<ManageTab>('teams');
  const [departments, setDepartments] = useState<Department[]>([]);

  const role = user?.role || 'employee';
  const isManager = role === 'manager';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, userRes, chanRes, deptRes] = await Promise.all([
        TeamModel.getAll(),
        UserModel.getAll({ limit: 200 }),
        ChannelModel.getAll(),
        DepartmentModel.getAll(),
      ]);
      setTeams(teamRes.data.data.teams || []);
      setUsers(userRes.data.data.users || []);
      setChannels(chanRes.data.data.channels || []);
      setDepartments(deptRes.data.data.departments || []);
    } catch {
      setTeams([]);
      setUsers([]);
      setChannels([]);
      setDepartments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!MANAGER_ROLES.includes(role)) return <Navigate to="/dashboard" replace />;

  // Managers manage only the teams they are assigned to; admins/super admins
  // manage every team in the company.
  const visibleTeams = isManager ? teams.filter((t) => t.user_role) : teams;
  const totalMembers = visibleTeams.reduce((sum, t) => sum + (t.member_count || 0), 0);
  const teamChannelCount = channels.filter((c) => c.team_id && visibleTeams.some((t) => t.id === c.team_id)).length;

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

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    setMessage(null);
    try {
      await TeamModel.update(editing.id, {
        name: editForm.name,
        description: editForm.description || undefined,
      });
      setEditing(null);
      setMessage('Team updated ✓');
      setTimeout(() => setMessage(null), 2000);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not update team');
    }
  };

  const inputCls =
    'w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lavender/40 focus:border-lavender text-sm';

  return (
    <div className="manager-page">
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

      <main className="manager-content">
        <div className="manager-tabs" role="tablist" aria-label="Management area">
          <button
            role="tab"
            aria-selected={tab === 'teams'}
            className={`manager-tab ${tab === 'teams' ? 'active' : ''}`}
            onClick={() => setTab('teams')}
          >
            Teams
          </button>
          <button
            role="tab"
            aria-selected={tab === 'attendance'}
            className={`manager-tab ${tab === 'attendance' ? 'active' : ''}`}
            onClick={() => setTab('attendance')}
          >
            Attendance
          </button>
        </div>

        {tab === 'attendance' && (
          <ManagerAttendanceView departments={departments} users={users} />
        )}

        {tab === 'teams' && (
        <>
        <div className="manager-hero">
          <div>
            <span className="manager-eyebrow">Team workspace</span>
            <h1>Team Management</h1>
            <p>
              {isManager
                ? `Manage the teams you're assigned to · ${roleLabel(role)}`
                : `Every team in the company · ${roleLabel(role)}`}
            </p>
          </div>
          <button className="btn-primary manager-add-button" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Cancel' : (<><Icon name="plus" size={13} /> Add team</>)}
          </button>
        </div>

        <div className="manager-stat-grid">
          <StatCard label="Assigned teams" value={visibleTeams.length} icon="grid" />
          <StatCard label="Team members" value={totalMembers} icon="users" />
          <StatCard label="Team channels" value={teamChannelCount} icon="hash" />
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
        {message && <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{message}</div>}

        {showCreate && (
          <CreateTeamModal
            users={users}
            onClose={() => setShowCreate(false)}
            onCreate={async (data) => {
              await TeamModel.create(data);
              await load();
            }}
          />
        )}

        <div className="manager-team-panel">
          <div className="manager-team-panel-heading">
            <div><h2>
              {isManager ? 'Your teams' : 'Teams'}{' '}
              <span>({visibleTeams.length})</span>
            </h2><p>Organize members and their conversations in one place.</p></div>
          </div>

          {editing && (
            <form
              onSubmit={handleEditSubmit}
              className="grid grid-cols-1 md:grid-cols-3 gap-3 px-6 py-4 bg-soft border-b border-line"
            >
              <input className={inputCls} placeholder="Team name" required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              <input className={inputCls} placeholder="Description" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
              <div className="flex gap-2">
                <button type="submit" className="btn-primary">Save</button>
                <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </form>
          )}

          {loading ? (
            <SkeletonTable rows={4} cells={4} />
          ) : visibleTeams.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon"><Icon name="grid" size={18} /></span>
              {isManager
                ? "You're not assigned to any teams yet — ask a Company Admin to add you to one."
                : 'No teams yet — use “Add team” above to organize your workspace.'}
            </div>
          ) : (
            <div className="table-scroll">
              <table className="admin-table manager-team-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Your role</th>
                  <th>Members</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleTeams.map((t) => (
                  <tr key={t.id}>
                    <td className="font-semibold">
                      <span className="manager-team-mark"><Icon name="grid" size={14} /></span><span className="manager-team-name">{t.name}{t.description && <small>{t.description}</small>}</span>
                    </td>
                    <td><TeamRoleBadge team={t} isManager={isManager} role={role} /></td>
                    <td className="text-muted">{t.member_count ?? 0}</td>
                    <td>
                      <div className="flex gap-2">
                        <button
                          className="btn-secondary !py-1 !px-2 !text-xs"
                          onClick={() => setViewingTeam(t)}
                        >
                          Manage
                        </button>
                        <button
                          className="btn-secondary !py-1 !px-2 !text-xs"
                          onClick={() => {
                            setEditing(t);
                            setEditForm({ name: t.name, description: t.description || '' });
                          }}
                        >
                          Edit
                        </button>
                        <ConfirmButton
                          label="Delete"
                          className="btn-danger !py-1 !px-2 !text-xs"
                          onConfirm={flash(async () => {
                            await TeamModel.remove(t.id);
                            await load();
                          })}
                        />
                      </div>
                    </td>
                  </tr>
              ))}
            </tbody>
            </table>
            </div>
          )}
        </div>

          <p className="manager-team-note">
            Member management and team channels open in the “Manage” panel. Deleting a team is permanent.
          </p>
        </>
        )}
      </main>

      {viewingTeam && (
        <TeamModal
          team={viewingTeam}
          channels={channels}
          users={users}
          currentUserId={user?.id ?? null}
          currentRole={role}
          onClose={() => { setViewingTeam(null); }}
          onOpenChannel={() => { setViewingTeam(null); }}
          onMembersChanged={load}
          onChannelsChanged={load}
        />
      )}
    </div>
  );
};

const StatCard = ({ label, value, icon }: { label: string; value: number; icon: IconName }) => (
  <div className="manager-stat-card">
    <div className="manager-stat-label">
      <span><Icon name={icon} size={15} /></span>
      <small>{label}</small>
    </div>
    <div className="manager-stat-value">{value.toLocaleString()}</div>
  </div>
);

export default Manager;
