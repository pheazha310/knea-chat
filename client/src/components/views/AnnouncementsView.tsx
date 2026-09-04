import React, { useState } from 'react';
import Icon from '../common/Icon';
import ConfirmButton from '../common/ConfirmButton';
import Avatar from '../common/Avatar';
import type {
  Announcement,
  AnnouncementReader,
  AnnouncementScope,
  CreateAnnouncementData,
  Department,
  Team,
} from '../../models';

interface AnnouncementsViewProps {
  announcements: Announcement[];
  currentUserId: number | null;
  /** Managers+ may publish, edit and delete announcements. */
  canPublish: boolean;
  departments: Department[];
  teams: Team[];
  onCreate: (data: CreateAnnouncementData) => Promise<unknown>;
  onUpdate: (id: number, data: Partial<CreateAnnouncementData>) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
  /** Mark an announcement as read by the current user. */
  onMarkRead: (id: number) => Promise<unknown>;
  /** Read-confirmation ledger for one announcement (manager+). */
  onLoadReaders: (id: number) => Promise<{
    readers: AnnouncementReader[];
    total_recipients: number;
  }>;
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

const formatDateTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const authorName = (a: Announcement) =>
  [a.creator_first_name, a.creator_last_name].filter(Boolean).join(' ').trim() || 'Someone';

const scopeLabel = (a: Announcement): string => {
  if (a.scope === 'department') {
    return a.department_name ? `Department · ${a.department_name}` : 'Department';
  }
  if (a.scope === 'team') {
    return a.team_name ? `Team · ${a.team_name}` : 'Team';
  }
  return 'Company';
};

const isUnpublished = (a: Announcement) => a.is_published !== undefined && a.is_published === 0;

const AnnouncementsView = ({
  announcements = [],
  currentUserId = null,
  canPublish = false,
  departments = [],
  teams = [],
  onCreate,
  onUpdate,
  onDelete,
  onMarkRead,
  onLoadReaders,
}: AnnouncementsViewProps) => {
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [scope, setScope] = useState<AnnouncementScope>('company');
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [teamId, setTeamId] = useState<number | ''>('');
  const [isPinned, setIsPinned] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read-confirmation modal state.
  const [readersFor, setReadersFor] = useState<Announcement | null>(null);
  const [readers, setReaders] = useState<AnnouncementReader[]>([]);
  const [totalRecipients, setTotalRecipients] = useState(0);
  const [readersBusy, setReadersBusy] = useState(false);

  const resetForm = () => {
    setTitle('');
    setContent('');
    setScope('company');
    setDepartmentId('');
    setTeamId('');
    setIsPinned(false);
    setScheduledAt('');
    setComposing(false);
    setEditing(null);
    setError(null);
  };

  const startEdit = (a: Announcement) => {
    setEditing(a);
    setComposing(false);
    setTitle(a.title);
    setContent(a.content);
    setScope(a.scope || 'company');
    setDepartmentId(a.department_id ?? '');
    setTeamId(a.team_id ?? '');
    setIsPinned(!!a.is_pinned);
    // Only unpublished (scheduled) announcements may be re-scheduled.
    setScheduledAt(isUnpublished(a) && a.scheduled_at ? toLocalInputValue(a.scheduled_at) : '');
    setError(null);
  };

  const targetMissing =
    (scope === 'department' && !departmentId) || (scope === 'team' && !teamId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim() || targetMissing) return;
    setBusy(true);
    setError(null);
    const data: CreateAnnouncementData = {
      title: title.trim(),
      content: content.trim(),
      scope,
      department_id: scope === 'department' ? Number(departmentId) : null,
      team_id: scope === 'team' ? Number(teamId) : null,
      is_pinned: isPinned,
      scheduled_at: scheduledAt || null,
    };
    try {
      if (editing) {
        await onUpdate(editing.id, data);
      } else {
        await onCreate(data);
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

  /** Expand a card and mark it read (read confirmation). */
  const handleOpen = (a: Announcement) => {
    if (isUnpublished(a)) return; // drafts aren't "readable" yet
    if (!a.is_read) {
      void onMarkRead(a.id).catch(() => {
        /* non-fatal; the next view load re-syncs read state */
      });
    }
  };

  const openReaders = async (a: Announcement) => {
    setReadersFor(a);
    setReaders([]);
    setTotalRecipients(a.total_recipients || 0);
    setReadersBusy(true);
    try {
      const { readers: list, total_recipients } = await onLoadReaders(a.id);
      setReaders(list);
      setTotalRecipients(total_recipients);
    } catch {
      setReaders([]);
    } finally {
      setReadersBusy(false);
    }
  };

  const readProgress = (a: Announcement) => {
    if (isUnpublished(a) || a.read_count === undefined) return null;
    const total = a.total_recipients ?? 0;
    if (total === 0) return '0 read';
    return `${a.read_count} / ${total} read`;
  };

  return (
    <div className="view-page">
      <div className="view-header">
        <div>
          <h1>Announcements</h1>
          <p>Company, department and team updates published by managers and admins.</p>
        </div>
        {canPublish && (
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setTitle('');
              setContent('');
              setScope('company');
              setDepartmentId('');
              setTeamId('');
              setIsPinned(false);
              setScheduledAt('');
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

          {/* Audience */}
          <div className="mt-3 mb-2">
            <label className="block text-xs font-semibold text-muted mb-1.5">
              Who should see this?
            </label>
            <div className="flex gap-2">
              {(['company', 'department', 'team'] as AnnouncementScope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`btn-secondary !py-1 !px-3 !text-xs capitalize ${
                    scope === s ? '!bg-lavender !text-white !border-lavender' : ''
                  }`}
                  onClick={() => setScope(s)}
                >
                  {s === 'company' ? 'Company' : s === 'department' ? 'Department' : 'Team'}
                </button>
              ))}
            </div>
            {scope === 'department' && (
              <select
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-lavender text-sm mt-2"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : '')}
                required
              >
                <option value="">Select a department…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
            {scope === 'team' && (
              <select
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-lavender text-sm mt-2"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : '')}
                required
              >
                <option value="">Select a team…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Options */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-1">
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={isPinned}
                onChange={(e) => setIsPinned(e.target.checked)}
                className="accent-lavender"
              />
              <Icon name="pin" size={14} className="text-amber-500" />
              Pin as important
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <Icon name="clock" size={14} className="text-muted" />
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                disabled={editing ? !isUnpublished(editing) : false}
                className="px-2 py-1 border border-gray-200 rounded-lg focus:outline-none focus:border-lavender text-sm"
              />
            </label>
            <span className="text-xs text-muted">
              {editing && !isUnpublished(editing)
                ? 'Already published — scheduling can’t be changed.'
                : 'Leave empty to publish now.'}
            </span>
          </div>

          <div className="flex justify-end gap-2 mt-3">
            <button type="button" className="btn-secondary" onClick={resetForm}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || !title.trim() || !content.trim() || targetMissing}
            >
              {busy
                ? 'Saving…'
                : editing
                  ? 'Save changes'
                  : scheduledAt
                    ? 'Schedule'
                    : 'Publish'}
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
              ? 'Publish one to reach the whole company, a department or a team.'
              : 'Company, department and team updates will show up here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => {
            const draft = isUnpublished(a);
            const unread = !draft && !a.is_read;
            return (
              <article
                key={a.id}
                className={`list-card !p-5 cursor-pointer transition-shadow hover:shadow-md ${
                  a.is_pinned ? '!border-amber-300' : ''
                }`}
                onClick={() => handleOpen(a)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3
                      className={`m-0 text-[15px] font-bold text-ink flex items-center gap-2 ${
                        unread ? '' : 'font-semibold'
                      }`}
                    >
                      {a.is_pinned ? (
                        <Icon name="pin" size={15} className="text-amber-500" />
                      ) : (
                        <Icon name="megaphone" size={15} className="text-lavender" />
                      )}
                      <span className="truncate">{a.title}</span>
                      {unread && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-white bg-lavender rounded-full px-2 py-0.5">
                          New
                        </span>
                      )}
                      {draft && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-white bg-amber-500 rounded-full px-2 py-0.5">
                          <Icon name="clock" size={10} className="inline mr-0.5" />
                          Scheduled
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>{authorName(a)}</span>
                      {a.created_by === currentUserId && <em className="you">You</em>}
                      <span>·</span>
                      <span>{relativeTime(a.created_at)}</span>
                      <span className="chip">{scopeLabel(a)}</span>
                      {draft && a.scheduled_at && (
                        <span className="chip !text-amber-600">
                          <Icon name="clock" size={11} className="inline mr-0.5" />
                          {formatDateTime(a.scheduled_at)}
                        </span>
                      )}
                      {!draft && readProgress(a) && (
                        <span className="chip">
                          <Icon name="check-circle" size={11} className="inline mr-0.5" />
                          {readProgress(a)}
                        </span>
                      )}
                    </p>
                  </div>
                  {canPublish && (
                    <div className="flex gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      {!draft && (
                        <button
                          className="btn-secondary !py-1 !px-2 !text-xs"
                          title="See who read this"
                          onClick={() => openReaders(a)}
                        >
                          <Icon name="eye" size={13} className="inline mr-1" />
                          Seen by
                        </button>
                      )}
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
            );
          })}
        </div>
      )}

      {/* Read-confirmation modal (manager+) */}
      {readersFor && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setReadersFor(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-xl max-w-md w-full mx-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-lg font-semibold">Read confirmation</h3>
              <button
                className="text-muted hover:text-ink"
                onClick={() => setReadersFor(null)}
                aria-label="Close"
              >
                <Icon name="x" size={18} />
              </button>
            </div>
            <p className="text-sm text-muted mb-4">
              {readers.length} of {totalRecipients} recipients have read “{readersFor.title}”
            </p>
            <div className="overflow-y-auto space-y-2">
              {readersBusy && <p className="text-sm text-muted">Loading…</p>}
              {!readersBusy && readers.length === 0 && (
                <p className="text-sm text-muted">No one has read this yet.</p>
              )}
              {readers.map((r) => (
                <div key={r.user_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <Avatar
                    person={{ id: r.user_id, first_name: r.first_name, last_name: r.last_name }}
                    className="small"
                  />
                  <div className="min-w-0 flex-1">
                    <b className="block text-sm text-ink truncate">
                      {[r.first_name, r.last_name].filter(Boolean).join(' ').trim() || 'Someone'}
                    </b>
                    {r.job_title && <span className="text-xs text-muted">{r.job_title}</span>}
                  </div>
                  <span className="text-xs text-muted flex-shrink-0">{formatDateTime(r.read_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Convert an ISO/DB datetime string to the value format of <input type="datetime-local">. */
const toLocalInputValue = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export default AnnouncementsView;