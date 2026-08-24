import React, { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import Avatar from '../common/Avatar';
import ConfirmButton from '../common/ConfirmButton';
import Icon from '../common/Icon';
import { ChannelModel, TeamModel } from '../../models';
import type { Channel, Team, User } from '../../models';

interface TeamModalProps {
  team: Team;
  channels: Channel[];
  users: User[];
  currentUserId: number | null;
  currentRole: string;
  onClose: () => void;
  onOpenChannel: (channel: Channel) => void;
  /** Open the team's shared conversation and close the modal (optional — hidden in management-only contexts). */
  onMessageTeam?: (team: Team) => void;
  onMembersChanged: () => void;
  onChannelsChanged?: () => void;
}

const TeamModal = ({
  team,
  channels,
  users,
  currentUserId,
  currentRole,
  onClose,
  onOpenChannel,
  onMessageTeam,
  onMembersChanged,
  onChannelsChanged,
}: TeamModalProps) => {
  const [members, setMembers] = useState<User[] | null>(null);
  const [addId, setAddId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Channels of this team — local copy so create/archive/delete reflect
  // immediately; the parent refreshes via onChannelsChanged when provided.
  const [teamChannels, setTeamChannels] = useState<Channel[]>([]);
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [newChannel, setNewChannel] = useState<{ name: string; type: 'public' | 'private' }>({ name: '', type: 'public' });
  const [openChannelId, setOpenChannelId] = useState<number | null>(null);
  const [channelMembers, setChannelMembers] = useState<Record<number, User[]>>({});
  const [channelAddId, setChannelAddId] = useState<Record<number, number | ''>>({});

  useEffect(() => {
    setTeamChannels(channels.filter((c) => c.team_id === team.id));
  }, [channels, team.id]);

  const canManage =
    currentRole === 'super_admin' || currentRole === 'admin' || currentRole === 'manager';

  // Employees may create channels inside any team they belong to (role matrix).
  const isTeamMember = members?.some((m) => m.id === currentUserId) ?? false;
  const canCreateChannel = canManage || isTeamMember;
  // Channel creators keep management of their own channel.
  const canManageChannel = (channel: Channel) =>
    canManage || channel.created_by === currentUserId;
  // The team creator may add/remove members of their own team.
  const canManageMembers = canManage || team.created_by === currentUserId;

  const loadMembers = async () => {
    try {
      const res = await TeamModel.getMembers(team.id);
      setMembers(res.data.data.members || []);
    } catch {
      setMembers([]);
    }
  };

  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.id]);

  const addable = users.filter(
    (u) => u.id !== currentUserId && !members?.some((m) => m.id === u.id),
  );

  const handleAdd = async () => {
    if (addId === '') return;
    setBusy(true);
    setError(null);
    try {
      await TeamModel.addMember(team.id, Number(addId));
      setAddId('');
      await loadMembers();
      onMembersChanged();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not add member');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (userId: number) => {
    setBusy(true);
    setError(null);
    try {
      await TeamModel.removeMember(team.id, userId);
      await loadMembers();
      onMembersChanged();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not remove member');
    } finally {
      setBusy(false);
    }
  };

  /* ----------------------------- channel actions ---------------------------- */

  const loadChannelMembers = async (channelId: number) => {
    try {
      const res = await ChannelModel.getMembers(channelId);
      setChannelMembers((prev) => ({ ...prev, [channelId]: res.data.data.members || [] }));
    } catch {
      setChannelMembers((prev) => ({ ...prev, [channelId]: [] }));
    }
  };

  const toggleChannelManage = async (channelId: number) => {
    if (openChannelId === channelId) {
      setOpenChannelId(null);
      return;
    }
    setOpenChannelId(channelId);
    await loadChannelMembers(channelId);
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannel.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await ChannelModel.create({
        name: newChannel.name.trim().toLowerCase().replace(/\s+/g, '-'),
        type: newChannel.type,
        team_id: team.id,
      });
      setTeamChannels((prev) => [...prev, res.data.data.channel]);
      setNewChannel({ name: '', type: 'public' });
      setShowChannelForm(false);
      onChannelsChanged?.();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not create channel');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleArchive = async (channel: Channel) => {
    setBusy(true);
    setError(null);
    try {
      const archived = channel.is_archived ? 0 : 1;
      await ChannelModel.update(channel.id, { is_archived: archived });
      setTeamChannels((prev) =>
        prev.map((c) => (c.id === channel.id ? { ...c, is_archived: archived } : c)),
      );
      onChannelsChanged?.();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not update channel');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteChannel = async (channel: Channel) => {
    setBusy(true);
    setError(null);
    try {
      await ChannelModel.remove(channel.id);
      setTeamChannels((prev) => prev.filter((c) => c.id !== channel.id));
      if (openChannelId === channel.id) setOpenChannelId(null);
      onChannelsChanged?.();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not delete channel');
    } finally {
      setBusy(false);
    }
  };

  const handleChannelAdd = async (channelId: number) => {
    const userId = channelAddId[channelId];
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      await ChannelModel.addMember(channelId, Number(userId));
      setChannelAddId((prev) => ({ ...prev, [channelId]: '' }));
      await loadChannelMembers(channelId);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not add channel member');
    } finally {
      setBusy(false);
    }
  };

  const handleChannelRemove = async (channelId: number, userId: number) => {
    setBusy(true);
    setError(null);
    try {
      await ChannelModel.removeMember(channelId, userId);
      await loadChannelMembers(channelId);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not remove channel member');
    } finally {
      setBusy(false);
    }
  };

  const addableChannelMembers = (channelId: number): User[] => {
    const current = channelMembers[channelId] || [];
    return users.filter((u) => u.id !== currentUserId && !current.some((m) => m.id === u.id));
  };

  return (
    <Modal title={`Team · ${team.name}`} onClose={onClose} width={640}>
      <p className="text-sm text-muted mb-4">
        {team.description || 'No description yet.'}
      </p>
      {/* Team conversations are restricted to team members + managers/admins. */}
      {onMessageTeam && (team.user_role || canManage) && (
        <button
          className="btn-primary w-full mb-4"
          onClick={() => {
            onMessageTeam(team);
            onClose();
          }}
        >
          <Icon name="message" size={13} /> Message team
        </button>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[13px] font-bold text-ink m-0">
            Members{' '}
            <span className="text-muted font-normal">
              {members ? members.length : '…'}
            </span>
          </h4>
          {canManageMembers && (
            <div className="flex gap-2">
              <select
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-lavender"
                value={addId}
                onChange={(e) => setAddId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Add member…</option>
                {addable.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.first_name} {u.last_name} · {u.email}
                  </option>
                ))}
              </select>
              <button
                className="btn-primary !py-1.5 !px-3 !text-xs"
                onClick={handleAdd}
                disabled={busy || addId === ''}
              >
                Add
              </button>
            </div>
          )}
        </div>
        <ul className="modal-member-list">
          {!members && <li className="text-muted text-sm">Loading…</li>}
          {members?.length === 0 && <li className="text-muted text-sm">No members yet.</li>}
          {members?.map((m) => (
            <li key={m.id}>
              <Avatar person={m} className="small" showStatus />
              <span className="flex-1">
                <b className="block text-[13px]">
                  {m.first_name} {m.last_name}
                  {m.id === currentUserId && <em className="you ml-1">You</em>}
                </b>
                <small className="text-muted block text-[11px]">{m.job_title || m.email}</small>
              </span>
              {canManageMembers && m.id !== currentUserId && (
                <button className="picker-remove" onClick={() => handleRemove(m.id)} title="Remove from team">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[13px] font-bold text-ink m-0">
            Team channels <span className="text-muted font-normal">{teamChannels.length}</span>
          </h4>
          {canCreateChannel && (
            <button
              className="btn-secondary !py-1 !px-2 !text-xs"
              onClick={() => setShowChannelForm((v) => !v)}
            >
              {showChannelForm ? 'Cancel' : (<><Icon name="plus" size={12} /> Channel</>)}
            </button>
          )}
        </div>

        {showChannelForm && canCreateChannel && (
          <form onSubmit={handleCreateChannel} className="flex gap-2 mb-3">
            <input
              className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-lavender"
              placeholder="Channel name (e.g. releases)"
              value={newChannel.name}
              onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
              required
            />
            <select
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-lavender"
              value={newChannel.type}
              onChange={(e) => setNewChannel({ ...newChannel, type: e.target.value as 'public' | 'private' })}
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
            <button
              type="submit"
              className="btn-primary !py-1.5 !px-3 !text-xs"
              disabled={busy || !newChannel.name.trim()}
            >
              Create
            </button>
          </form>
        )}

        {teamChannels.length === 0 ? (
          <p className="text-xs text-muted">No channels in this team yet.</p>
        ) : (
          <ul className="modal-member-list">
            {teamChannels.map((c) => (
              <React.Fragment key={c.id}>
                <li
                  className={canManageChannel(c) ? '' : 'cursor-pointer'}
                  onClick={
                    canManageChannel(c)
                      ? undefined
                      : () => {
                          onOpenChannel(c);
                          onClose();
                        }
                  }
                >
                  <Icon name="hash" size={14} className="text-muted" />
                  <span className="flex-1">
                    <b className="block text-[13px]">{c.name}</b>
                    <small className="text-muted block text-[11px]">{c.description || c.type}</small>
                  </span>
                  <span className="text-muted text-xs">{c.member_count ?? 0} members</span>
                  {canManageChannel(c) && (
                    <button
                      className="btn-secondary !py-1 !px-2 !text-xs"
                      onClick={() => toggleChannelManage(c.id)}
                    >
                      {openChannelId === c.id ? 'Close' : 'Manage'}
                    </button>
                  )}
                </li>
                {canManageChannel(c) && openChannelId === c.id && (
                  <li className="!bg-soft !block">
                    <div className="py-2">
                      <div className="flex gap-2 mb-2 flex-wrap items-center">
                        <button
                          className="btn-secondary !py-1 !px-2 !text-xs"
                          onClick={() => handleToggleArchive(c)}
                        >
                          {c.is_archived ? 'Restore' : 'Archive'}
                        </button>
                        <ConfirmButton
                          label="Delete"
                          className="btn-danger !py-1 !px-2 !text-xs"
                          onConfirm={() => handleDeleteChannel(c)}
                        />
                        <select
                          className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-lavender"
                          value={channelAddId[c.id] ?? ''}
                          onChange={(e) =>
                            setChannelAddId((prev) => ({
                              ...prev,
                              [c.id]: e.target.value ? Number(e.target.value) : '',
                            }))
                          }
                        >
                          <option value="">Add member…</option>
                          {addableChannelMembers(c.id).map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.first_name} {u.last_name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn-primary !py-1 !px-2 !text-xs"
                          disabled={busy || !channelAddId[c.id]}
                          onClick={() => handleChannelAdd(c.id)}
                        >
                          Add
                        </button>
                      </div>
                      <ul className="modal-member-list">
                        {(channelMembers[c.id] || []).length === 0 && (
                          <li className="text-muted text-sm">No members yet.</li>
                        )}
                        {(channelMembers[c.id] || []).map((m) => (
                          <li key={m.id}>
                            <Avatar person={m} className="small" showStatus />
                            <span className="flex-1">
                              <b className="block text-[13px]">
                                {m.first_name} {m.last_name}
                              </b>
                              <small className="text-muted block text-[11px]">{m.job_title || m.email}</small>
                            </span>
                            <button
                              className="picker-remove"
                              disabled={busy}
                              onClick={() => handleChannelRemove(c.id, m.id)}
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </li>
                )}
              </React.Fragment>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
};

export default TeamModal;
