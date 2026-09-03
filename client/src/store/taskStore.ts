// taskStore — Zustand store for tasks (assignment, team scope, deadlines,
// status, comments, attachments).
import { create } from 'zustand';
import { TaskModel } from '../models';
import type { Task, TaskComment, TaskAttachment, CreateTaskInput, TaskListParams } from '../models';

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
