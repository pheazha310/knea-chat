// Task domain model — MVVM Model layer.
// Holds the `Task` entity plus `TaskModel`, the data access for the /tasks
// endpoints (assignment, deadlines, status, team scope, comments,
// attachments).
import api, { API_BASE_URL } from '../services/api';

export type TaskStatus = 'open' | 'in_progress' | 'completed';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface Task {
  id: number;
  company_id: number;
  /** Non-null when the task belongs to a team (visible to its members). */
  team_id?: number | null;
  created_by: number;
  assignee_id?: number | null;
  title: string;
  description?: string | null;
  due_date?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
  assignee_first_name?: string | null;
  assignee_last_name?: string | null;
  assignee_email?: string | null;
  assignee_profile_picture?: string | null;
  creator_first_name?: string | null;
  creator_last_name?: string | null;
  team_name?: string | null;
  is_overdue?: boolean;
}

export interface TaskComment {
  id: number;
  task_id: number;
  user_id: number;
  content: string;
  created_at: string;
  updated_at: string;
  author_first_name?: string | null;
  author_last_name?: string | null;
  author_email?: string | null;
  author_profile_picture?: string | null;
}

export interface TaskAttachment {
  id: number;
  task_id: number;
  uploaded_by: number;
  file_name: string;
  file_url: string;
  file_type?: string | null;
  file_size?: number | null;
  created_at: string;
  uploader_first_name?: string | null;
  uploader_last_name?: string | null;
  uploader_email?: string | null;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  team_id?: number | null;
  assignee_id?: number | null;
  due_date?: string | null;
  priority?: TaskPriority;
}

export interface TaskListParams {
  status?: string;
  search?: string;
  priority?: string;
  /** Specific assignee (managers); omitted for everyone. */
  assignee_id?: number;
  /** undefined = all, 0 = personal tasks, positive = a specific team. */
  team_id?: number;
  page?: number;
  limit?: number;
}

/** File URL resolver shared by task attachments and the rest of the app. */
export const resolveTaskFileUrl = (fileUrl: string) => {
  if (/^https?:\/\//.test(fileUrl)) return fileUrl;
  const origin = API_BASE_URL.replace(/\/api$/, '');
  return `${origin}${fileUrl}`;
};

export const TaskModel = {
  getAll: (params?: TaskListParams) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.search) query.set('search', params.search);
    if (params?.priority) query.set('priority', params.priority);
    if (params?.assignee_id !== undefined && params.assignee_id !== null) query.set('assignee_id', String(params.assignee_id));
    if (params?.team_id !== undefined && params.team_id !== null) query.set('team_id', String(params.team_id));
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return api.get<{ success: boolean; data: { tasks: Task[]; total: number } }>(
      `/tasks${qs ? `?${qs}` : ''}`,
    );
  },

  create: (data: CreateTaskInput) =>
    api.post<{ success: boolean; data: { task: Task } }>('/tasks', data),

  update: (id: number, data: Partial<CreateTaskInput> & { status?: TaskStatus }) =>
    api.patch<{ success: boolean; data: { task: Task } }>(`/tasks/${id}`, data),

  remove: (id: number) =>
    api.delete<{ success: boolean; message: string }>(`/tasks/${id}`),

  // Comments
  getComments: (taskId: number) =>
    api.get<{ success: boolean; data: { comments: TaskComment[] } }>(`/tasks/${taskId}/comments`),
  addComment: (taskId: number, content: string) =>
    api.post<{ success: boolean; data: { comment: TaskComment } }>(`/tasks/${taskId}/comments`, { content }),
  removeComment: (taskId: number, commentId: number) =>
    api.delete<{ success: boolean; message: string }>(`/tasks/${taskId}/comments/${commentId}`),

  // Attachments
  getAttachments: (taskId: number) =>
    api.get<{ success: boolean; data: { attachments: TaskAttachment[] } }>(`/tasks/${taskId}/attachments`),
  uploadAttachment: (taskId: number, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<{ success: boolean; data: { attachment: TaskAttachment } }>(
      `/tasks/${taskId}/attachments`,
      formData,
    );
  },
  removeAttachment: (taskId: number, attachmentId: number) =>
    api.delete<{ success: boolean; message: string }>(`/tasks/${taskId}/attachments/${attachmentId}`),
};
