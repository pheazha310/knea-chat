import React, { useState } from 'react';
import Modal from './Modal';
import MemberPicker from '../common/MemberPicker';
import type { User } from '../../models';

interface CreateTeamModalProps {
  users: User[];
  onClose: () => void;
  onCreate: (data: {
    name: string;
    description: string;
    member_ids?: number[];
  }) => Promise<unknown>;
}

const CreateTeamModal = ({ users, onClose, onCreate }: CreateTeamModalProps) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim(),
        member_ids: memberIds.length ? memberIds : undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not create team');
      setSaving(false);
    }
  };

  const inputCls =
    'w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lavender/40 focus:border-lavender text-sm transition-colors';

  return (
    <Modal title="Create a team" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}
        <label className="block text-sm font-semibold text-ink mb-1.5">Team name</label>
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Platform Squad"
          required
          autoFocus
        />
        <label className="block text-sm font-semibold text-ink mb-1.5 mt-4">Description</label>
        <textarea
          className={`${inputCls} resize-none`}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What will this team work on?"
        />
        <label className="block text-sm font-semibold text-ink mb-1.5 mt-4">
          Members{' '}
          <span className="text-muted font-normal">({memberIds.length} selected)</span>
        </label>
        <MemberPicker users={users} selected={memberIds} onChange={setMemberIds} />
        <p className="text-xs text-muted mt-3">
          You will become the team leader; selected members are added as regular members.
        </p>
        <div className="flex justify-end gap-3 mt-5">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create team'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default CreateTeamModal;
