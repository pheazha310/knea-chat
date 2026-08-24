// MemberPicker — searchable multi-select for choosing members at creation
// time (create team / create channel). Shows every user with a checkbox and
// filters as you type. Selected ids are reported back via onChange.
import React, { useMemo, useState } from 'react';
import Avatar from './Avatar';
import type { User } from '../../models';

interface MemberPickerProps {
  users: User[];
  selected: number[];
  onChange: (ids: number[]) => void;
}

const MemberPicker = ({ users = [], selected, onChange }: MemberPickerProps) => {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? users.filter((u) =>
          `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase().includes(q),
        )
      : users;
    return [...list].sort((a, b) =>
      `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`),
    );
  }, [users, query]);

  const toggle = (id: number) => {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div>
      <input
        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-lavender text-xs mb-2"
        placeholder="Search people…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
        {filtered.length === 0 && (
          <p className="text-xs text-muted p-3">No people match “{query}”.</p>
        )}
        {filtered.map((u) => (
          <label
            key={u.id}
            className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-soft"
          >
            <input
              type="checkbox"
              className="accent-lavender"
              checked={selected.includes(u.id)}
              onChange={() => toggle(u.id)}
            />
            <Avatar person={u} className="small" />
            <span className="flex-1 min-w-0">
              <b className="block text-[13px] truncate">
                {u.first_name} {u.last_name}
              </b>
              <small className="text-muted block text-[11px] truncate">{u.email}</small>
            </span>
            {selected.includes(u.id) && (
              <span className="text-[10px] font-bold text-lavender uppercase">Added</span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
};

export default MemberPicker;
