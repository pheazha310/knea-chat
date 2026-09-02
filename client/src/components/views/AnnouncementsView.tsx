import React, { useState } from 'react';
import Icon from '../common/Icon';
import ConfirmButton from '../common/ConfirmButton';
import type { Announcement } from '../../models';

interface AnnouncementsViewProps {
  announcements: Announcement[];
  currentUserId: number | null;
  /** Managers+ may publish, edit and delete announcements. */
  canPublish: boolean;
  onCreate: (data: { title: string; content: string }) => Promise<unknown>;
  onUpdate: (id: number, data: { title: string; content: string }) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
}

const relativeTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const authorName = (a: Announcement) =>
  [a.creator_first_name, a.creator_last_name].filter(Boolean).join(' ').trim() || 'Someone';

const AnnouncementsView = ({
  announcements = [],
  currentUserId = null,
  canPublish = false,
  onCreate,
  onUpdate,
  onDelete,
}: AnnouncementsViewProps) => {
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setTitle('');
    setContent('');
    setComposing(false);
    setEditing(null);
    setError(null);
  };

  const startEdit = (a: Announcement) => {
    setEditing(a);
    setComposing(false);
    setTitle(a.title);
    setContent(a.content);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await onUpdate(editing.id, { title: title.trim(), content: content.trim() });
      } else {
        await onCreate({ title: title.trim(), content: content.trim() });
      }
      resetForm();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not save announcement');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (a: Announcement) => {
    setError(null);
    try {
      await onDelete(a.id);
      if (editing?.id === a.id) resetForm();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not delete announcement');
    }
  };

  return (
    <div className="view-page">
      <div className="view-header">
        <div>
          <h1>Announcements</h1>
          <p>Company-wide updates published by managers and admins.</p>
        </div>
        {canPublish && (
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setTitle('');
              setContent('');
              setComposing((v) => !v);
              setError(null);
            }}
          >
            <Icon name="plus" size={14} /> New announcement
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {(composing || editing) && (
        <form onSubmit={handleSubmit} className="list-card mb-5 !p-4">
          <b className="block mb-2">
            {editing ? 'Edit announcement' : 'Publish announcement'}
          </b>
          <input
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-lavender text-sm mb-3"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            required
          />
          <textarea
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-lavender text-sm resize-none"
            rows={4}
            placeholder="What should everyone know?"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" className="btn-secondary" onClick={resetForm}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || !title.trim() || !content.trim()}
            >
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Publish'}
            </button>
          </div>
        </form>
      )}

      {announcements.length === 0 ? (
        <div className="empty-conversation">
          <div className="empty-conversation-icon">
            <Icon name="megaphone" size={22} />
          </div>
          <b>No announcements yet</b>
          <p className="center">
            {canPublish
              ? 'Publish one to update the whole company.'
              : 'Company-wide updates will show up here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <article key={a.id} className="list-card !p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="m-0 text-[15px] font-bold text-ink flex items-center gap-2">
                    <Icon name="megaphone" size={15} className="text-lavender" />
                    {a.title}
                  </h3>
                  <p className="text-xs text-muted mt-1">
                    {authorName(a)}
                    {a.created_by === currentUserId && (
                      <em className="you ml-1">You</em>
                    )}
                    {' · '}
                    {relativeTime(a.created_at)}
                  </p>
                </div>
                {canPublish && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      className="btn-secondary !py-1 !px-2 !text-xs"
                      onClick={() => startEdit(a)}
                    >
                      Edit
                    </button>
                    <ConfirmButton
                      label="Delete"
                      className="btn-danger !py-1 !px-2 !text-xs"
                      onConfirm={() => handleDelete(a)}
                    />
                  </div>
                )}
              </div>
              <p className="text-sm text-ink leading-relaxed mt-2 mb-0 whitespace-pre-wrap">
                {a.content}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default AnnouncementsView;
