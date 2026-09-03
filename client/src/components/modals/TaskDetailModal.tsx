// TaskDetailModal — detail view for a single task: edit the fields the user
// may touch, flip the status, and manage comments + attachments. Data comes
// from the task store (which talks to the /tasks REST endpoints).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../common/Icon';
import Avatar from '../common/Avatar';
import ConfirmButton from '../common/ConfirmButton';
import Modal from './Modal';
import { useTaskStore } from '../../store/taskStore';
import { resolveTaskFileUrl } from '../../models/Task';
import type { Task, User, Team, TaskPriority, TaskStatus } from '../../models';

interface TaskDetailModalProps {
  task: Task;
  users: User[];
  teams: Team[];
  canManage: boolean;
  currentUserId?: number | null;
  onClose: () => void;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  completed: 'Done',
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#ef4444',
};

const personName = (first?: string | null, last?: string | null, email?: string | null) =>
  [first, last].filter(Boolean).join(' ').trim() || email || 'Someone';

const formatDate = (value?: string | null) => {
  if (!value) return '';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatBytes = (bytes?: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

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

const TaskDetailModal = ({
  task,
  users,
  teams,
  canManage,
  currentUserId,
  onClose,
}: TaskDetailModalProps) => {
  const {
    commentsByTask,
    attachmentsByTask,
    loadComments,
    addComment,
    deleteComment,
    loadAttachments,
    uploadAttachment,
    deleteAttachment,
    updateTask,
  } = useTaskStore();

  const comments = commentsByTask[task.id] || [];
  const attachments = attachmentsByTask[task.id] || [];

  // The modal can only edit when the user is a manager/creator.
  const canTouch = canManage || task.created_by === currentUserId;
  // Status may also be flipped by the assignee or a member of the task's team.
  const isAssignee = task.assignee_id != null && task.assignee_id === currentUserId;
  const isTeamMember = !!task.team_id && teams.some((t) => t.id === task.team_id && !!t.user_role);
  const canChangeStatus = canTouch || isAssignee || isTeamMember;

  // Assignee options: anyone for managers, otherwise just the current user.
  const assigneeOptions = useMemo(() => {
    const list = canManage ? users : users.filter((u) => u.id === currentUserId);
    return list;
  }, [users, canManage, currentUserId]);

  // Team options: managers may pick any team; employees only their own.
  const teamOptions = useMemo(() => {
    const list = canManage ? teams : teams.filter((t) => !!t.user_role);
    return list;
  }, [teams, canManage]);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [dueDate, setDueDate] = useState(task.due_date || '');
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assigneeId, setAssigneeId] = useState<number | ''>(task.assignee_id || '');
  const [teamId, setTeamId] = useState<number | ''>(task.team_id || '');
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [commentText, setCommentText] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Fresh data every time the modal opens for a task.
  useEffect(() => {
    loadComments(task.id);
    loadAttachments(task.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // Keep local edit state in sync when the store pushes an updated task
  // (e.g. after a status flip).
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description || '');
    setDueDate(task.due_date || '');
    setPriority(task.priority);
    setAssigneeId(task.assignee_id || '');
    setTeamId(task.team_id || '');
  }, [task.id, task.title, task.description, task.due_date, task.priority, task.assignee_id, task.team_id]);

  const startEdit = () => {
    setTitle(task.title);
    setDescription(task.description || '');
    setDueDate(task.due_date || '');
    setPriority(task.priority);
    setAssigneeId(task.assignee_id || '');
    setTeamId(task.team_id || '');
    setError(null);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!title.trim()) {
      setError('Task title is required');
      return;
    }
    setSaveBusy(true);
    setError(null);
    const updated = await updateTask(task.id, {
      title: title.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      priority,
      assignee_id: assigneeId === '' ? null : Number(assigneeId),
      team_id: teamId === '' ? null : Number(teamId),
    });
    setSaveBusy(false);
    if (updated) setEditing(false);
    else setError(useTaskStore.getState().error || 'Failed to save changes');
  };

  const handleStatus = (status: TaskStatus) => {
    void updateTask(task.id, { status });
  };

  const handleComment = async () => {
    const content = commentText.trim();
    if (!content) return;
    setCommentBusy(true);
    const comment = await addComment(task.id, content);
    setCommentBusy(false);
    if (comment) setCommentText('');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadBusy(true);
    await uploadAttachment(task.id, file);
    setUploadBusy(false);
  };

  const statusSelect = canChangeStatus ? (
    <select
      className="form-select !py-1.5 !px-2 !text-xs w-auto"
      aria-label="Task status"
      value={task.status}
      onChange={(e) => handleStatus(e.target.value as TaskStatus)}
    >
      {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
      ))}
    </select>
  ) : (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-gray-800 text-muted"
    >
      {STATUS_LABELS[task.status]}
    </span>
  );

  return (
    <Modal onClose={onClose} title="Task" width={620}>
      <div className="task-detail">
        {/* Header: title + status */}
        <div className="flex items-start gap-3">
          <span
            className="w-2.5 h-2.5 rounded-full mt-2 flex-shrink-0"
            style={{ backgroundColor: PRIORITY_COLORS[task.priority] || '#94a3b8' }}
            title={`${task.priority} priority`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className={`text-base font-semibold ${task.status === 'completed' ? 'text-muted line-through' : 'text-ink'}`}>
                {task.title}
              </h4>
            </div>
            {task.description && !editing && (
              <p className="text-sm text-muted mt-1 whitespace-pre-wrap">{task.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {statusSelect}
            {canTouch && !editing && (
              <button className="btn-secondary !py-1.5 !px-2.5 !text-xs" onClick={startEdit} aria-label="Edit task">
                <Icon name="edit" size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="task-detail-meta">
          <span className="inline-flex items-center gap-1.5">
            <Avatar
              person={{
                id: task.assignee_id,
                first_name: task.assignee_first_name,
                last_name: task.assignee_last_name,
                profile_picture: task.assignee_profile_picture,
              }}
              className="tiny"
            />
            <span className="text-xs text-ink">
              {personName(task.assignee_first_name, task.assignee_last_name, task.assignee_email)}
            </span>
          </span>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Icon name="calendar" size={11} />
            {task.due_date ? formatDate(task.due_date) : 'No due date'}
          </span>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Icon name="grid" size={11} />
            {task.team_name ? `Team · ${task.team_name}` : 'Personal'}
          </span>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <span className="text-xs text-muted">
            by {personName(task.creator_first_name, task.creator_last_name)}
          </span>
        </div>

        {/* Edit form */}
        {editing && (
          <div className="space-y-3 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">Title *</label>
              <input className="form-input w-full" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">Description</label>
              <textarea
                className="form-input w-full min-h-[64px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">Assignee</label>
                <select
                  className="form-select w-full"
                  value={assigneeId}
                  disabled={assigneeOptions.length === 0}
                  onChange={(e) => setAssigneeId(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  <option value="">Unassigned</option>
                  {assigneeOptions.map((u) => (
                    <option key={u.id} value={u.id}>{personName(u.first_name, u.last_name, u.email)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">Team</label>
                <select
                  className="form-select w-full"
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  <option value="">Personal</option>
                  {teamOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">Due date</label>
                <input
                  type="date"
                  className="form-input w-full"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">Priority</label>
                <select
                  className="form-select w-full"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
            {error && (
              <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn-primary" disabled={saveBusy} onClick={saveEdit}>
                <Icon name="check" size={13} /> Save
              </button>
            </div>
          </div>
        )}

        {/* Comments */}
        <section className="task-detail-section">
          <h5 className="task-detail-heading">
            <Icon name="message" size={13} /> Comments ({comments.length})
          </h5>
          <ul className="task-comment-list">
            {comments.length === 0 && (
              <li className="text-xs text-muted">No comments yet — add the first one below.</li>
            )}
            {comments.map((c) => (
              <li key={c.id} className="task-comment">
                <Avatar
                  person={{
                    id: c.user_id,
                    first_name: c.author_first_name,
                    last_name: c.author_last_name,
                    profile_picture: c.author_profile_picture,
                  }}
                  className="tiny"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <b className="text-xs text-ink">{personName(c.author_first_name, c.author_last_name, c.author_email)}</b>
                    <time className="text-[11px] text-muted">{relativeTime(c.created_at)}</time>
                  </div>
                  <p className="text-sm text-ink whitespace-pre-wrap mt-0.5">{c.content}</p>
                </div>
                {(canManage || c.user_id === currentUserId) && (
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete comment?"
                    className="btn-danger task-comment-delete"
                    onConfirm={() => deleteComment(task.id, c.id)}
                  />
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 mt-2">
            <input
              className="form-input w-full !text-sm"
              placeholder="Add a comment…"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleComment();
                }
              }}
              aria-label="Add a comment"
            />
            <button
              className="btn-primary !py-2 !px-3"
              disabled={commentBusy || !commentText.trim()}
              onClick={handleComment}
              aria-label="Post comment"
            >
              <Icon name="send" size={13} />
            </button>
          </div>
        </section>

        {/* Attachments */}
        <section className="task-detail-section">
          <h5 className="task-detail-heading">
            <Icon name="paperclip" size={13} /> Attachments ({attachments.length})
          </h5>
          <ul className="task-attachment-list">
            {attachments.length === 0 && (
              <li className="text-xs text-muted">No attachments yet.</li>
            )}
            {attachments.map((a) => (
              <li key={a.id} className="task-attachment">
                <span className="task-attachment-icon"><Icon name="file" size={14} /></span>
                <div className="flex-1 min-w-0">
                  <a
                    href={resolveTaskFileUrl(a.file_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-ink font-medium truncate block hover:underline"
                    title={a.file_name}
                  >
                    {a.file_name}
                  </a>
                  <span className="text-[11px] text-muted">
                    {formatBytes(a.file_size)}
                    {a.uploader_first_name ? ` · by ${personName(a.uploader_first_name, a.uploader_last_name, a.uploader_email)}` : ''}
                  </span>
                </div>
                <a
                  href={resolveTaskFileUrl(a.file_url)}
                  download={a.file_name}
                  className="icon-button"
                  aria-label={`Download ${a.file_name}`}
                  title="Download"
                >
                  <Icon name="download" size={14} />
                </a>
                {(canManage || a.uploaded_by === currentUserId) && (
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete attachment?"
                    className="btn-danger task-comment-delete"
                    onConfirm={() => deleteAttachment(task.id, a.id)}
                  />
                )}
              </li>
            ))}
          </ul>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
            aria-label="Upload attachment"
          />
          <button
            className="btn-secondary mt-2"
            disabled={uploadBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="paperclip" size={13} /> {uploadBusy ? 'Uploading…' : 'Attach file'}
          </button>
        </section>
      </div>
    </Modal>
  );
};

export default TaskDetailModal;