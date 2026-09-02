import React, { useMemo, useState } from 'react';
import Modal from './Modal';
import Avatar from '../common/Avatar';
import type { User } from '../../models';

interface CreateGroupModalProps {
  users: User[];
  currentUserId: number | null;
  onClose: () => void;
  onDirect: (userId: number) => Promise<unknown>;
  onCreateGroup: (name: string, participantIds: number[]) => Promise<unknown>;
}

const CreateGroupModal = ({
  users,
  currentUserId,
  onClose,
  onDirect,
  onCreateGroup,
}: CreateGroupModalProps) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groupName, setGroupName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const people = useMemo(
    () => users.filter((u) => u.id !== currentUserId),
    [users, currentUserId],
  );
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return people;
    return people.filter((u) =>
      `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase().includes(q),
    );
  }, [people, query]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const ids = Array.from(selected);
      if (ids.length === 1) {
        await onDirect(ids[0]);
      } else if (ids.length > 1) {
        const name =
          groupName.trim() ||
          people
            .filter((p) => selected.has(p.id))
            .map((p) => p.first_name)
            .join(', ');
        await onCreateGroup(name, ids);
      }
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not start chat');
      setSaving(false);
    }
  };

  return (
    <Modal title="Start a new chat" onClose={onClose} width={500}>
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}
        <p className="text-xs text-muted mb-3">
          Pick <b>1 person</b> for a direct message, or <b>2+ people</b> to create a group chat.
        </p>
        <input
          className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lavender/40 focus:border-lavender text-sm mb-3"
          placeholder="Search people…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {selected.size > 1 && (
          <input
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lavender/40 focus:border-lavender text-sm mb-3"
            placeholder="Group chat name (optional)"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
        )}
        <div className="modal-picker-list">
          {filtered.length === 0 && (
            <div className="text-muted text-sm py-6 text-center">No people match “{query}”</div>
          )}
          {filtered.map((u) => {
            const checked = selected.has(u.id);
            return (
              <button
                type="button"
                key={u.id}
                className={`picker-row ${checked ? 'checked' : ''}`}
                onClick={() => toggle(u.id)}
              >
                <Avatar person={u} className="small" showStatus />
                <span className="flex-1 text-left">
                  <b className="block text-[13px]">
                    {u.first_name} {u.last_name}
                  </b>
                  <small className="text-muted block text-[11px]">{u.job_title || u.email}</small>
                </span>
                <span className="picker-check">{checked ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-muted">
            {selected.size} selected ·{' '}
            {selected.size === 1 ? 'direct message' : selected.size > 1 ? 'group chat' : 'nothing yet'}
          </span>
          <div className="flex gap-3">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving || selected.size === 0}>
              {saving ? 'Starting…' : 'Start chat'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default CreateGroupModal;
