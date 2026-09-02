import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import MemberPicker from '../common/MemberPicker';
import type { Team, User } from '../../models';

interface CreateChannelModalProps {
  teams: Team[];
  users: User[];
  /** Role of the signed-in user — gates standalone channels and team options. */
  currentRole: string;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    description: string;
    type: 'public' | 'private';
    team_id?: number | null;
    member_ids?: number[];
  }) => Promise<unknown>;
}

const CreateChannelModal = ({ teams, users, onClose, onCreate, currentRole }: CreateChannelModalProps) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'public' | 'private'>('public');
  const [team_id, setTeamId] = useState<number | null>(null);
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Managers+ may create standalone channels or channels in any team.
  // Employees may only create channels inside teams they belong to
  // (role matrix — "Create channels: according to permission").
  const isManagerPlus =
    currentRole === 'super_admin' || currentRole === 'admin' || currentRole === 'manager';
  const teamOptions = isManagerPlus ? teams : teams.filter((t) => t.user_role);

  // For employees, default the team selector to their first team so the
  // visible selection always matches what gets submitted.
  useEffect(() => {
    if (!isManagerPlus && team_id === null && teamOptions.length > 0) {
      setTeamId(teamOptions[0].id);
    }
  }, [isManagerPlus, team_id, teams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!clean) return;
    if (!isManagerPlus && !team_id) {
      setError('Please choose a team you belong to.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        name: clean,
        description: description.trim(),
        type,
        team_id,
        member_ids: memberIds.length ? memberIds : undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not create channel');
      setSaving(false);
    }
  };

  const inputCls =
    'w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lavender/40 focus:border-lavender text-sm transition-colors';

  return (
    <Modal title="Create a channel" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}
        <label className="block text-sm font-semibold text-ink mb-1.5">
          Name <span className="text-muted font-normal">(no spaces, lowercase)</span>
        </label>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg text-muted">#</span>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. project-launch"
            required
            autoFocus
          />
        </div>
        <label className="block text-sm font-semibold text-ink mb-1.5">Description</label>
        <textarea
          className={`${inputCls} resize-none`}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this channel about?"
        />
        <div className="grid grid-cols-2 gap-3 my-4">
          <div>
            <label className="block text-sm font-semibold text-ink mb-1.5">Visibility</label>
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as 'public' | 'private')}>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink mb-1.5">
              Team {isManagerPlus ? '(optional)' : '(required)'}
            </label>
            <select
              className={inputCls}
              value={team_id ?? ''}
              onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : null)}
            >
              {isManagerPlus && <option value="">— No team —</option>}
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              {!isManagerPlus && teamOptions.length === 0 && (
                <option value="">No teams available</option>
              )}
            </select>
          </div>
        </div>
        <label className="block text-sm font-semibold text-ink mb-1.5">
          Members{' '}
          <span className="text-muted font-normal">({memberIds.length} selected)</span>
        </label>
        <MemberPicker users={users} selected={memberIds} onChange={setMemberIds} />
        <p className="text-xs text-muted mt-2">
          You will become the channel admin; selected members are added as regular members.
        </p>
        <div className="flex justify-end gap-3 mt-5">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create channel'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default CreateChannelModal;
