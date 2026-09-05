// TaskDetailModal — detail view for a single task: edit the fields the user
// may touch, flip the status, and manage comments + attachments. Data comes
// from the task store (which talks to the /tasks REST endpoints).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../common/Icon';
import Avatar from '../common/Avatar';
import ConfirmButton from '../common/ConfirmButton';
import Modal from './Modal';
import ReactionBar from '../common/ReactionBar';
import { useTaskStore } from '../../store/taskStore';
import { resolveTaskFileUrl } from '../../models/Task';
import type { Reaction, Task, User, Team, TaskPriority, TaskStatus } from '../../models';

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

const STATUS_COLORS: Record<TaskStatus, { bg: string; text: string; border: string }> = {
  open: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  in_progress: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  completed: { bg: '#ecfdf5', text: '#065f46', border: '#a7f3d0' },
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
    toggleReaction,
  } = useTaskStore();

  const comments = commentsByTask[task.id] || [];
  const attachments = attachmentsByTask[task.id] || [];

  const canTouch = canManage || task.created_by === currentUserId;
  const isAssignee = task.assignee_id != null && task.assignee_id === currentUserId;
  const isTeamMember = !!task.team_id && teams.some((t) => t.id === task.team_id && !!t.user_role);
  const canChangeStatus = canTouch || isAssignee || isTeamMember;

  const assigneeOptions = useMemo(() => {
    const list = canManage ? users : users.filter((u) => u.id === currentUserId);
    return list;
  }, [users, canManage, currentUserId]);

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

  // Reaction chips — local snapshot so the modal reacts instantly, kept in
  // sync with the store (which also mirrors live task_reacted broadcasts).
  const [reactionList, setReactionList] = useState<Reaction[]>(task.reactions || []);

  useEffect(() => {
    setReactionList(task.reactions || []);
  }, [task.reactions]);

  const handleToggleReaction = async (emoji: string, mine: boolean) => {
    const fresh = await toggleReaction(task.id, emoji, mine);
    if (fresh !== null) setReactionList(fresh);
    return fresh;
  };

  useEffect(() => {
    loadComments(task.id);
    loadAttachments(task.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

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

  const sc = STATUS_COLORS[task.status] || STATUS_COLORS.open;

  const statusSelect = canChangeStatus ? (
    <select
      className="task-status-select"
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
      className="task-status-pill"
      style={{
        background: sc.bg,
        color: sc.text,
        borderColor: sc.border,
      }}
    >
      {STATUS_LABELS[task.status]}
    </span>
  );

  return (
    <Modal onClose={onClose} title="Task" width={620}>
      <div className="task-detail">
        {/* Header */}
        <div className="task-detail-header">
          <div className="task-detail-header-main">
            <div className="task-detail-title-row">
              <span
                className="task-detail-priority-dot"
                style={{ backgroundColor: PRIORITY_COLORS[task.priority] || '#94a3b8' }}
                title={`${task.priority} priority`}
              />
              <h4 className={`task-detail-title ${task.status === 'completed' ? 'is-completed' : ''}`}>
                {task.title}
              </h4>
            </div>
            {task.description && !editing && (
              <p className="task-detail-description">{task.description}</p>
            )}
          </div>
          <div className="task-detail-header-actions">
            {statusSelect}
            {canTouch && !editing && (
              <button className="task-icon-btn" onClick={startEdit} aria-label="Edit task" title="Edit task">
                <Icon name="edit" size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="task-detail-meta-grid">
          <div className="task-meta-item">
            <span className="task-meta-label">Assignee</span>
            <span className="task-meta-value">
              <Avatar
                person={{
                  id: task.assignee_id,
                  first_name: task.assignee_first_name,
                  last_name: task.assignee_last_name,
                  profile_picture: task.assignee_profile_picture,
                }}
                className="tiny"
              />
              <span className="task-meta-text">
                {personName(task.assignee_first_name, task.assignee_last_name, task.assignee_email)}
              </span>
            </span>
          </div>
          <div className="task-meta-item">
            <span className="task-meta-label">Due date</span>
            <span className="task-meta-value">
              <Icon name="calendar" size={13} className="task-meta-icon" />
              <span className={`task-meta-text ${task.is_overdue && task.status !== 'completed' ? 'is-overdue' : ''}`}>
                {task.due_date ? formatDate(task.due_date) : 'No due date'}
              </span>
            </span>
          </div>
          <div className="task-meta-item">
            <span className="task-meta-label">Team</span>
            <span className="task-meta-value">
              <Icon name="grid" size={13} className="task-meta-icon" />
              <span className="task-meta-text">
                {task.team_name ? `Team · ${task.team_name}` : 'Personal'}
              </span>
            </span>
          </div>
          <div className="task-meta-item">
            <span className="task-meta-label">Priority</span>
            <span className="task-meta-value">
              <span
                className="task-priority-dot-sm"
                style={{ backgroundColor: PRIORITY_COLORS[task.priority] || '#94a3b8' }}
              />
              <span className="task-meta-text">{PRIORITY_LABELS[task.priority]}</span>
            </span>
          </div>
          <div className="task-meta-item">
            <span className="task-meta-label">Created by</span>
            <span className="task-meta-value">
              <span className="task-meta-text">
                {personName(task.creator_first_name, task.creator_last_name)}
              </span>
            </span>
          </div>
        </div>

        {/* Reactions */}
        <div className="task-detail-reactions">
          <ReactionBar
            reactions={reactionList}
            meId={currentUserId}
            onToggle={handleToggleReaction}
            label="React to the task"
          />
        </div>

        {/* Edit form */}
        {editing && (
          <div className="task-edit-form">
            <div className="task-edit-row">
              <div className="task-edit-field">
                <label className="task-edit-label">Title *</label>
                <input className="task-edit-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
              </div>
            </div>
            <div className="task-edit-row">
              <div className="task-edit-field">
                <label className="task-edit-label">Description</label>
                <textarea
                  className="task-edit-input task-edit-textarea"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
            <div className="task-edit-grid">
              <div className="task-edit-field">
                <label className="task-edit-label">Assignee</label>
                <select
                  className="task-edit-select"
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
              <div className="task-edit-field">
                <label className="task-edit-label">Team</label>
                <select
                  className="task-edit-select"
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  <option value="">Personal</option>
                  {teamOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div className="task-edit-field">
                <label className="task-edit-label">Due date</label>
                <input
                  type="date"
                  className="task-edit-input"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="task-edit-field">
                <label className="task-edit-label">Priority</label>
                <select
                  className="task-edit-select"
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
              <div className="task-error">
                <Icon name="alert" size={14} />
                {error}
              </div>
            )}
            <div className="task-edit-actions">
              <button className="task-btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button className="task-btn-primary" disabled={saveBusy} onClick={saveEdit}>
                <Icon name="check" size={13} /> Save
              </button>
            </div>
          </div>
        )}

        {/* Comments */}
        <section className="task-detail-section">
          <h5 className="task-section-title">
            <Icon name="message" size={14} />
            Comments
            <span className="task-section-count">{comments.length}</span>
          </h5>
          <div className="task-comment-list">
            {comments.length === 0 && (
              <div className="task-empty-state">
                <Icon name="message" size={22} />
                <p>No comments yet — add the first one below.</p>
              </div>
            )}
            {comments.map((c) => (
              <div key={c.id} className="task-comment">
                <Avatar
                  person={{
                    id: c.user_id,
                    first_name: c.author_first_name,
                    last_name: c.author_last_name,
                    profile_picture: c.author_profile_picture,
                  }}
                  className="tiny"
                />
                <div className="task-comment-body">
                  <div className="task-comment-header">
                    <b className="task-comment-author">{personName(c.author_first_name, c.author_last_name, c.author_email)}</b>
                    <time className="task-comment-time">{relativeTime(c.created_at)}</time>
                  </div>
                  <p className="task-comment-text">{c.content}</p>
                </div>
                {(canManage || c.user_id === currentUserId) && (
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete comment?"
                    className="task-delete-btn"
                    onConfirm={() => deleteComment(task.id, c.id)}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="task-comment-input-row">
            <input
              className="task-comment-input"
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
              className="task-btn-icon"
              disabled={commentBusy || !commentText.trim()}
              onClick={handleComment}
              aria-label="Post comment"
              title="Post comment"
            >
              <Icon name="send" size={14} />
            </button>
          </div>
        </section>

        {/* Attachments */}
        <section className="task-detail-section">
          <h5 className="task-section-title">
            <Icon name="paperclip" size={14} />
            Attachments
            <span className="task-section-count">{attachments.length}</span>
          </h5>
          <div className="task-attachment-list">
            {attachments.length === 0 && (
              <div className="task-empty-state">
                <Icon name="paperclip" size={22} />
                <p>No attachments yet.</p>
              </div>
            )}
            {attachments.map((a) => (
              <div key={a.id} className="task-attachment">
                <span className="task-attachment-icon">
                  <Icon name="file" size={15} />
                </span>
                <div className="task-attachment-info">
                  <a
                    href={resolveTaskFileUrl(a.file_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="task-attachment-name"
                    title={a.file_name}
                  >
                    {a.file_name}
                  </a>
                  <span className="task-attachment-meta">
                    {formatBytes(a.file_size)}
                    {a.uploader_first_name ? ` · by ${personName(a.uploader_first_name, a.uploader_last_name, a.uploader_email)}` : ''}
                  </span>
                </div>
                <a
                  href={resolveTaskFileUrl(a.file_url)}
                  download={a.file_name}
                  className="task-btn-icon"
                  aria-label={`Download ${a.file_name}`}
                  title="Download"
                >
                  <Icon name="download" size={14} />
                </a>
                {(canManage || a.uploaded_by === currentUserId) && (
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete attachment?"
                    className="task-delete-btn"
                    onConfirm={() => deleteAttachment(task.id, a.id)}
                  />
                )}
              </div>
            ))}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
            aria-label="Upload attachment"
          />
          <button
            className="task-btn-secondary mt-3"
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
