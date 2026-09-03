/**
 * Task types — mirror the `tasks` table plus the joined assignee/creator/team
 * columns returned by the task queries. Comments and attachments live in the
 * `task_comments` / `task_attachments` tables (migration 021).
 */
export type TaskStatus = 'open' | 'in_progress' | 'completed';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskRow {
  id: number;
  company_id: number;
  /** Non-null when the task belongs to a team (visible to its members). */
  team_id: number | null;
  created_by: number;
  assignee_id: number | null;
  title: string;
  description: string | null;
  due_date: Date | string | null;
  priority: TaskPriority;
  status: TaskStatus;
  completed_at: Date | string | null;
  deadline_reminded_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  // Joined assignee columns
  assignee_first_name?: string | null;
  assignee_last_name?: string | null;
  assignee_email?: string | null;
  assignee_profile_picture?: string | null;
  // Joined creator columns
  creator_first_name?: string | null;
  creator_last_name?: string | null;
  // Joined team columns
  team_name?: string | null;
  // Computed by the service when a due date has passed without completion.
  is_overdue?: boolean;
}

export interface CreateTaskData {
  company_id: number;
  created_by: number;
  title: string;
  description?: string | null;
  team_id?: number | null;
  assignee_id?: number | null;
  due_date?: string | null;
  priority?: TaskPriority;
}

export interface UpdateTaskData {
  title?: string;
  description?: string | null;
  team_id?: number | null;
  assignee_id?: number | null;
  due_date?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
}

export interface TaskFilters {
  companyId: number;
  /** Restrict to tasks assigned to this user (used for the assignee scope). */
  assigneeId?: number;
  /** Restrict to tasks created by this user. */
  createdById?: number;
  /** Restrict to tasks of a specific team (used for the team scope). */
  teamId?: number;
  status?: string;
  priority?: string;
  search?: string;
  page?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Task comments (migration 021)
// ---------------------------------------------------------------------------

export interface TaskCommentRow {
  id: number;
  task_id: number;
  user_id: number;
  content: string;
  created_at: Date | string;
  updated_at: Date | string;
  // Joined author columns
  author_first_name?: string | null;
  author_last_name?: string | null;
  author_email?: string | null;
  author_profile_picture?: string | null;
}

export interface CreateTaskCommentData {
  task_id: number;
  user_id: number;
  content: string;
}

// ---------------------------------------------------------------------------
// Task attachments (migration 021)
// ---------------------------------------------------------------------------

export interface TaskAttachmentRow {
  id: number;
  task_id: number;
  uploaded_by: number;
  file_name: string;
  file_url: string;
  file_type: string | null;
  file_size: number | null;
  created_at: Date | string;
  // Joined uploader columns
  uploader_first_name?: string | null;
  uploader_last_name?: string | null;
  uploader_email?: string | null;
}

export interface CreateTaskAttachmentData {
  task_id: number;
  uploaded_by: number;
  file_name: string;
  file_url: string;
  file_type: string | null;
  file_size: number | null;
}
