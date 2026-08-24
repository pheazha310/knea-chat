import React, { useState } from 'react';
import Modal from '../modals/Modal';
import Avatar from '../common/Avatar';
import { SearchModel } from '../../models';
import type { MessageSearchResult, User } from '../../models';

interface SearchModalProps {
  onClose: () => void;
  onJumpToMessage: (result: MessageSearchResult) => void;
  onJumpToUser: (user: User) => void;
}

const SearchModal = ({ onClose, onJumpToMessage, onJumpToUser }: SearchModalProps) => {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<MessageSearchResult[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setSearched(true);
    try {
      const [msgRes, userRes] = await Promise.all([
        SearchModel.messages(query),
        SearchModel.users(query),
      ]);
      setMessages(msgRes.data.data?.results || []);
      setUsers(userRes.data.data?.results || []);
    } catch {
      setMessages([]);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  /** Highlight every case-insensitive occurrence of the query. */
  const Highlight = ({ text, query }: { text: string; query: string }) => {
    const q = query.trim();
    if (!q) return <>{text}</>;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'ig'));
    return (
      <>
        {parts.map((part, i) =>
          i % 2 === 1 ? (
            <mark key={i}>{part}</mark>
          ) : (
            <React.Fragment key={i}>{part}</React.Fragment>
          ),
        )}
      </>
    );
  };

  const formatTime = (value?: string) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  return (
    <Modal title="Search" onClose={onClose} width={560}>
      <form onSubmit={handleSearch}>
        <div className="flex gap-2 mb-4">
          <input
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lavender/40 focus:border-lavender text-sm"
            placeholder="Search messages and people…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn-primary" disabled={loading || !q.trim()}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      {searched && !loading && messages.length === 0 && users.length === 0 && (
        <div className="text-center py-8 text-muted text-sm">
          No results for “{q}”
        </div>
      )}

      {users.length > 0 && (
        <section className="mb-5">
          <h4 className="search-section-title">PEOPLE</h4>
          {users.map((u) => (
            <button
              key={u.id}
              className="picker-row w-full"
              onClick={() => onJumpToUser(u)}
            >
              <Avatar person={u} className="small" showStatus />
              <span className="flex-1 text-left">
                <b className="block text-[13px]">
                  {u.first_name} {u.last_name}
                </b>
                <small className="text-muted block text-[11px]">{u.job_title || u.email}</small>
              </span>
            </button>
          ))}
        </section>
      )}

      {messages.length > 0 && (
        <section>
          <h4 className="search-section-title">MESSAGES</h4>
          <ul className="search-results">
            {messages.map((m) => (
              <li key={m.id}>
                <button className="w-full text-left" onClick={() => onJumpToMessage(m)}>
                  <span className="block text-[13px] text-ink">
                    <b>{m.first_name} {m.last_name}</b>
                    <span className="text-muted font-normal">
                      {' '}· {m.conversation_type === 'channel' ? '#' : ''}
                      {m.conversation_type || 'conversation'}
                    </span>
                    <time>{formatTime(m.created_at)}</time>
                  </span>
                  <span className="search-snippet">
                    <Highlight text={m.content} query={q} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  );
};

export default SearchModal;
