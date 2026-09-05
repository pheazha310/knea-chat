// taskStore — Zustand store for tasks (assignment, team scope, deadlines,
// status, comments, attachments).
import { create } from 'zustand';
import { TaskModel } from '../models';
import type { Task, TaskComment, TaskAttachment, CreateTaskInput, TaskListParams, Reaction } from '../models';
import { useAuthStore } from './authStore';

/** Task reactions with an in-flight toggle request (guards double-clicks). */
const reactionInFlight = new Set<string>();

interface TaskState {
  tasks: Task[];
  total: number;
  isLoading: boolean;
  error: string | null;

  commentsByTask: Record<number, TaskComment[]>;
  attachmentsByTask: Record<number, TaskAttachment[]>;

  setTasks: (tasks: Task[], total: number) => void;
  setError: (error: string | null) => void;
  loadTasks: (params?: TaskListParams) => Promise<void>;
  createTask: (data: CreateTaskInput) => Promise<Task | null>;
  updateTask: (id: number, data: Partial<CreateTaskInput> & { status?: Task['status'] }) => Promise<Task | null>;
  deleteTask: (id: number) => Promise<boolean>;
  loadComments: (taskId: number) => Promise<TaskComment[]>;
  addComment: (taskId: number, content: string) => Promise<TaskComment | null>;
  deleteComment: (taskId: number, commentId: number) => Promise<boolean>;
  loadAttachments: (taskId: number) => Promise<TaskAttachment[]>;
  uploadAttachment: (taskId: number, file: File) => Promise<TaskAttachment | null>;
  deleteAttachment: (taskId: number, attachmentId: number) => Promise<boolean>;
  /** Replace the reaction list on a cached task (live broadcasts). */
  applyReactions: (taskId: number, reactions: Reaction[]) => void;
  /** Add or remove the current user's emoji on a task. Resolves with the
   *  fresh reaction list (null on failure). */
  toggleReaction: (
    taskId: number,
    reaction: string,
    knownMine?: boolean,
  ) => Promise<Reaction[] | null>;
  clear: () => void;
}

export const useTaskStore = create<TaskState>()((set, get) => ({
  tasks: [],
  total: 0,
  isLoading: false,
  error: null,
  commentsByTask: {},
  attachmentsByTask: {},

  setTasks: (tasks, total) => set({ tasks, total }),
  setError: (error) => set({ error }),

  loadTasks: async (params = {}) => {
    set({ isLoading: true, error: null });
    try {
      const response = await TaskModel.getAll(params);
      const tasks = response.data.data?.tasks || [];
      const total = response.data.data?.total || 0;
      set({ tasks, total, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  createTask: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const response = await TaskModel.create(data);
      const task = response.data.data?.task;
      if (task) {
        set((state) => ({ tasks: [task, ...state.tasks], total: state.total + 1, isLoading: false }));
      }
      return task || null;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return null;
    }
  },

  updateTask: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const response = await TaskModel.update(id, data);
      const task = response.data.data?.task;
      if (task) {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === id ? task : t)),
          isLoading: false,
        }));
      }
      return task || null;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return null;
    }
  },

  deleteTask: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await TaskModel.remove(id);
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== id),
        total: state.total - 1,
        isLoading: false,
      }));
      return true;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return false;
    }
  },

  applyReactions: (taskId, reactions) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, reactions } : t,
      ),
    })),

  toggleReaction: async (taskId, reaction, knownMine) => {
    const key = `${taskId}:${reaction}`;
    if (reactionInFlight.has(key)) return null;
    reactionInFlight.add(key);
    try {
      const current = get().tasks.find((t) => t.id === taskId);
      const userId = useAuthStore.getState().user?.id ?? null;
      const cachedMine =
        current?.reactions?.some(
          (r) => userId !== null && Number(r.user_id) === Number(userId) && r.reaction === reaction,
        ) ?? false;
      const mine = current ? cachedMine : (knownMine ?? false);
      const res = mine
        ? await TaskModel.removeReaction(taskId, reaction)
        : await TaskModel.addReaction(taskId, reaction);
      const reactions: Reaction[] = res.data?.data?.reactions || [];
      get().applyReactions(taskId, reactions);
      return reactions;
    } catch (error) {
      set({ error: (error as Error).message });
      return null;
    } finally {
      reactionInFlight.delete(key);
    }
  },

  loadComments: async (taskId) => {
    try {
      const response = await TaskModel.getComments(taskId);
      const comments = response.data.data?.comments || [];
      set((state) => ({ commentsByTask: { ...state.commentsByTask, [taskId]: comments } }));
      return comments;
    } catch (error) {
      set({ error: (error as Error).message });
      return [];
    }
  },

  addComment: async (taskId, content) => {
    try {
      const response = await TaskModel.addComment(taskId, content);
      const comment = response.data.data?.comment;
      if (comment) {
        set((state) => ({
          commentsByTask: {
            ...state.commentsByTask,
            [taskId]: [...(state.commentsByTask[taskId] || []), comment],
          },
        }));
      }
      return comment || null;
    } catch (error) {
      set({ error: (error as Error).message });
      return null;
    }
  },

  deleteComment: async (taskId, commentId) => {
    try {
      await TaskModel.removeComment(taskId, commentId);
      set((state) => ({
        commentsByTask: {
          ...state.commentsByTask,
          [taskId]: (state.commentsByTask[taskId] || []).filter((c) => c.id !== commentId),
        },
      }));
      return true;
    } catch (error) {
      set({ error: (error as Error).message });
      return false;
    }
  },

  loadAttachments: async (taskId) => {
    try {
      const response = await TaskModel.getAttachments(taskId);
      const attachments = response.data.data?.attachments || [];
      set((state) => ({ attachmentsByTask: { ...state.attachmentsByTask, [taskId]: attachments } }));
      return attachments;
    } catch (error) {
      set({ error: (error as Error).message });
      return [];
    }
  },

  uploadAttachment: async (taskId, file) => {
    try {
      const response = await TaskModel.uploadAttachment(taskId, file);
      const attachment = response.data.data?.attachment;
      if (attachment) {
        set((state) => ({
          attachmentsByTask: {
            ...state.attachmentsByTask,
            [taskId]: [...(state.attachmentsByTask[taskId] || []), attachment],
          },
        }));
      }
      return attachment || null;
    } catch (error) {
      set({ error: (error as Error).message });
      return null;
    }
  },

  deleteAttachment: async (taskId, attachmentId) => {
    try {
      await TaskModel.removeAttachment(taskId, attachmentId);
      set((state) => ({
        attachmentsByTask: {
          ...state.attachmentsByTask,
          [taskId]: (state.attachmentsByTask[taskId] || []).filter((a) => a.id !== attachmentId),
        },
      }));
      return true;
    } catch (error) {
      set({ error: (error as Error).message });
      return false;
    }
  },

  clear: () => set({
    tasks: [],
    total: 0,
    isLoading: false,
    error: null,
    commentsByTask: {},
    attachmentsByTask: {},
  }),
}));
