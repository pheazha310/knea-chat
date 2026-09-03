import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../common/Icon';
import Avatar from '../common/Avatar';
import ConfirmButton from '../common/ConfirmButton';
import Modal from '../modals/Modal';
import TaskDetailModal from '../modals/TaskDetailModal';
import { useTaskStore } from '../../store/taskStore';
import type { Task, User, Team, TaskPriority, TaskStatus } from '../../models';

interface TasksViewProps {
  users: User[];
  teams: Team[];
  canManage: boolean;
  currentUserId?: number | null;
}

type ViewMode = 'list' | 'board';

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

const STATUS_FILTERS: Array<{ key: TaskStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Done' },
];

const BOARD_COLUMNS: TaskStatus[] = ['open', 'in_progress', 'completed'];

const personName = (first?: string | null, last?: string | null, email?: string | null) =>
  [first, last].filter(Boolean).join(' ').trim() || email || 'Someone';

const relativeDue = (due: string, overdue?: boolean) => {
  if (!due) return null;
  const target = new Date(`${due}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 0) return overdue ? `Overdue · ${due}` : `Due ${due}`;
  if (days < 7) return `Due in ${days} days`;
  return `Due ${due}`;
};

const TasksView = ({ users, teams, canManage, currentUserId }: TasksViewProps) => {
  const { tasks, total, isLoading, error, loadTasks, createTask, updateTask, deleteTask } = useTaskStore();
  const [mode, setMode] = useState<ViewMode>('list');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  // team_id filter: 'all' = every team, 0 = personal tasks, >0 = one team.
  const [teamFilter, setTeamFilter] = useState<number | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | ''>('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const draggedId = useRef<number | null>(null);
  const lastDragEnd = useRef(0);
  const [busy, setBusy] = useState(false);
  // Create form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState<number | ''>('');
  const [teamId, setTeamId] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [formError, setFormError] = useState<string | null>(null);

  // Team options: managers may assign into any team; employees only their own.
  const teamOptions = useMemo(() => {
    const list = canManage ? teams : teams.filter((t) => !!t.user_role);
    return list;
  }, [teams, canManage]);

  // Reload whenever a filter changes (search debounced).
  useEffect(() => {
    const timer = setTimeout(() => {
      loadTasks({
        search: search || undefined,
        status: mode === 'list' && statusFilter !== 'all' ? statusFilter : undefined,
        priority: priorityFilter || undefined,
        team_id: teamFilter === 'all' ? undefined : Number(teamFilter),
      });
    }, search ? 250 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, search, teamFilter, priorityFilter, mode]);

  // Assignee options: anyone for managers, otherwise just the current user.
  const assigneeOptions = useMemo(() => {
    const list = canManage
      ? users
      : users.filter((u) => u.id === currentUserId);
    return list;
  }, [users, canManage, currentUserId]);

  const openCreate = () => {
    setTitle('');
    setDescription('');
    setAssigneeId('');
    setDueDate('');
    setPriority('medium');
    // When scoped to a team, pre-select it (if the user may use it).
    const scopedTeam = teamFilter !== 'all' && teamFilter > 0 ? teamFilter : '';
    setTeamId(teamOptions.some((t) => t.id === scopedTeam) ? scopedTeam : '');
    setFormError(null);
    setShowCreate(true);
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      setFormError('Task title is required');
      return;
    }
    setBusy(true);
    setFormError(null);
    const task = await createTask({
      title: title.trim(),
      description: description.trim() || null,
      assignee_id: assigneeId === '' ? null : Number(assigneeId),
      team_id: teamId === '' ? null : Number(teamId),
      due_date: dueDate || null,
      priority,
    });
    setBusy(false);
    if (task) setShowCreate(false);
    else setFormError(useTaskStore.getState().error || 'Failed to create task');
  };

  const canTouchTask = (task: Task) =>
    canManage || task.created_by === currentUserId;

  const handleStatus = (task: Task, status: TaskStatus) => {
    void updateTask(task.id, { status });
  };

  // ── Kanban drag & drop ───────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, taskId: number) => {
    draggedId.current = taskId;
    e.dataTransfer.setData('text/plain', String(taskId));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    draggedId.current = null;
    lastDragEnd.current = Date.now();
    setDragOver(null);
  };

  const handleDrop = (status: TaskStatus) => {
    const id = draggedId.current;
    setDragOver(null);
    draggedId.current = null;
    if (!id || !tasks.some((t) => t.id === id)) return;
    const task = tasks.find((t) => t.id === id);
    if (task && task.status !== status) void updateTask(id, { status });
  };

  const boardColumns = useMemo(
    () =>
      BOARD_COLUMNS.map((status) => ({
        status,
        tasks: tasks.filter((t) => t.status === status),
      })),
    [tasks],
  );

  const selectedTask = selectedTaskId !== null
    ? tasks.find((t) => t.id === selectedTaskId) || null
    : null;

  const scopedTeams = useMemo(() => {
    const list = canManage ? teams : teams.filter((t) => !!t.user_role);
    return list;
  }, [teams, canManage]);

  return (
    <div className="view-page">
      <div className="view-header">
        <div>
          <h1>
            Tasks
            {!isLoading && <span className="sf-count">{total}</span>}
          </h1>
          <p>Assigned work with deadlines — {canManage ? 'assign to your team' : 'yours to track'}.</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <Icon name="plus" size={14} /> {canManage ? 'Assign task' : 'New task'}
        </button>
      </div>

      <div className="sf-toolbar">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="sf-tabs view-mode-toggle" role="group" aria-label="Task view mode">
            <button
              role="tab"
              aria-selected={mode === 'list'}
              className={`sf-tab ${mode === 'list' ? 'active' : ''}`}
              onClick={() => setMode('list')}
              title="List view"
            >
              <Icon name="list" size={14} /> List
            </button>
            <button
              role="tab"
              aria-selected={mode === 'board'}
              className={`sf-tab ${mode === 'board' ? 'active' : ''}`}
              onClick={() => setMode('board')}
              title="Kanban board"
            >
              <Icon name="columns" size={14} /> Board
            </button>
          </div>

          {mode === 'list' && (
            <div className="sf-tabs" role="tablist" aria-label="Task status filter">
              {STATUS_FILTERS.map((item) => (
                <button
                  key={item.key}
                  role="tab"
                  aria-selected={statusFilter === item.key}
                  className={`sf-tab ${statusFilter === item.key ? 'active' : ''}`}
                  onClick={() => setStatusFilter(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          <select
            className="form-select !py-1.5 !px-2 !text-xs w-auto"
            aria-label="Filter by scope"
            value={teamFilter === 'all' ? 'all' : String(teamFilter)}
            onChange={(e) => {
              const v = e.target.value;
              setTeamFilter(v === 'all' ? 'all' : Number(v));
            }}
          >
            <option value="all">All tasks</option>
            <option value="0">Personal tasks</option>
            {scopedTeams.map((t) => (
              <option key={t.id} value={t.id}>Team · {t.name}</option>
            ))}
          </select>

          <select
            className="form-select !py-1.5 !px-2 !text-xs w-auto"
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | '')}
          >
            <option value="">Any priority</option>
            {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => (
              <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </div>
        <div className="sf-search">
          <Icon name="search" size={14} />
          <input
            type="text"
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search tasks"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-sm">
          {error}
        </div>
      )}

      {isLoading && tasks.length === 0 && mode === 'list' && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="list-card !p-4 animate-pulse">
              <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-3" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && tasks.length === 0 && (
        <div className="empty-conversation">
          <div className="empty-conversation-icon"><Icon name="check-circle" size={32} /></div>
          <b>{search || teamFilter !== 'all' || priorityFilter ? 'No tasks match' : 'No tasks yet'}</b>
          <p className="center">
            {search || teamFilter !== 'all' || priorityFilter
              ? 'Try a different search or filter.'
              : canManage
                ? 'Assign the first task — the assignee gets a notification.'
                : 'Tasks assigned to you will appear here.'}
          </p>
          {!search && teamFilter === 'all' && !priorityFilter && (
            <button className="btn-primary mt-2" onClick={openCreate}>
              <Icon name="plus" size={14} /> {canManage ? 'Assign a task' : 'Create a task'}
            </button>
          )}
        </div>
      )}

      {tasks.length > 0 && mode === 'list' && (
        <div className="space-y-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="list-card !p-4 task-row"
              onClick={() => setSelectedTaskId(task.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedTaskId(task.id);
                }
              }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0"
                  style={{ backgroundColor: PRIORITY_COLORS[task.priority] || '#94a3b8' }}
                  title={`${task.priority} priority`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-semibold truncate ${task.status === 'completed' ? 'text-muted line-through' : 'text-ink'}`}>
                      {task.title}
                    </p>
                    {task.status === 'completed' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                        <Icon name="check" size={10} /> Done
                      </span>
                    )}
                    {task.team_name && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                        <Icon name="grid" size={9} /> {task.team_name}
                      </span>
                    )}
                  </div>
                  {task.description && (
                    <p className="text-xs text-muted mt-1 line-clamp-2">{task.description}</p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted mt-2 flex-wrap">
                    {task.due_date && (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                          task.is_overdue && task.status !== 'completed'
                            ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300 border-red-200 dark:border-red-800'
                            : 'bg-gray-50 dark:bg-gray-800 text-muted border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <Icon name="clock" size={11} />
                        {relativeDue(task.due_date, !!task.is_overdue)}
                      </span>
                    )}
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
                      <span className="text-ink">
                        {personName(task.assignee_first_name, task.assignee_last_name, task.assignee_email)}
                      </span>
                    </span>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span>
                      by {personName(task.creator_first_name, task.creator_last_name)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <select
                    className="form-select !py-1.5 !px-2 !text-xs w-auto"
                    aria-label={`Status for ${task.title}`}
                    value={task.status}
                    disabled={
                      !canTouchTask(task) && task.assignee_id !== currentUserId
                    }
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleStatus(task, e.target.value as TaskStatus)}
                  >
                    {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                  {canTouchTask(task) && (
                    <ConfirmButton
                      label="Delete"
                      confirmLabel="Delete task?"
                      className="btn-danger sf-delete"
                      onConfirm={() => deleteTask(task.id)}
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tasks.length > 0 && mode === 'board' && (
        <div className="task-board" role="region" aria-label="Kanban board">
          {boardColumns.map((col) => (
            <div
              key={col.status}
              className={`task-board-column ${dragOver === col.status ? 'drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOver(col.status);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(col.status);
              }}
            >
              <header className="task-board-column-header">
                <span className={`task-board-dot ${col.status}`} />
                <b>{STATUS_LABELS[col.status]}</b>
                <span className="task-board-count">{col.tasks.length}</span>
              </header>
              <div className="task-board-cards">
                {col.tasks.length === 0 && (
                  <p className="task-board-empty">Drop tasks here</p>
                )}
                {col.tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`task-board-card ${task.status === 'completed' ? 'done' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => {
                      // Some browsers fire click right after a drag ends.
                      if (Date.now() - lastDragEnd.current < 400) return;
                      setSelectedTaskId(task.id);
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${task.title} (${STATUS_LABELS[task.status]})`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedTaskId(task.id);
                      }
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="w-2 h-2 rounded-full mt-1 flex-shrink-0"
                        style={{ backgroundColor: PRIORITY_COLORS[task.priority] || '#94a3b8' }}
                        title={`${task.priority} priority`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`text-[13px] font-semibold leading-snug ${task.status === 'completed' ? 'text-muted line-through' : 'text-ink'}`}>
                          {task.title}
                        </p>
                        {task.team_name && (
                          <p className="text-[11px] text-muted mt-0.5 truncate">
                            <Icon name="grid" size={9} /> {task.team_name}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          {task.due_date && (
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] ${
                                task.is_overdue && task.status !== 'completed'
                                  ? 'text-red-500 dark:text-red-400'
                                  : 'text-muted'
                              }`}
                            >
                              <Icon name="clock" size={10} />
                              {relativeDue(task.due_date, !!task.is_overdue)}
                            </span>
                          )}
                          <span
                            className="ml-auto"
                            title={personName(task.assignee_first_name, task.assignee_last_name, task.assignee_email)}
                          >
                            <Avatar
                              person={{
                                id: task.assignee_id,
                                first_name: task.assignee_first_name,
                                last_name: task.assignee_last_name,
                                profile_picture: task.assignee_profile_picture,
                              }}
                              className="tiny"
                            />
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} title={canManage ? 'Assign a task' : 'New task'}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">
                Title *
              </label>
              <input
                className="form-input w-full"
                placeholder="What needs to be done?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">
                Description
              </label>
              <textarea
                className="form-input w-full min-h-[72px]"
                placeholder="Optional details…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">
                  Assignee
                </label>
                <select
                  className="form-select w-full"
                  value={assigneeId}
                  disabled={assigneeOptions.length === 0}
                  onChange={(e) => setAssigneeId(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  <option value="">Unassigned</option>
                  {assigneeOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {personName(u.first_name, u.last_name, u.email)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">
                  Team
                </label>
                <select
                  className="form-select w-full"
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  <option value="">Personal task</option>
                  {teamOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">
                  Due date
                </label>
                <input
                  type="date"
                  className="form-input w-full"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">
                  Priority
                </label>
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

            {formError && (
              <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                {formError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy} onClick={handleCreate}>
                <Icon name="check" size={13} /> {canManage ? 'Assign' : 'Create'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          users={users}
          teams={teams}
          canManage={canManage}
          currentUserId={currentUserId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
};

export default TasksView;