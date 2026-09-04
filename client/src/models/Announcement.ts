// Announcement domain model — MVVM Model layer.
// Holds the `Announcement` entity plus `AnnouncementModel`, the data access
// for the /announcements endpoints (SRS FR-24).
import api from '../services/api';

export type AnnouncementScope = 'company' | 'department' | 'team';

export interface Announcement {
  id: number;
  company_id: number;
  scope: AnnouncementScope;
  department_id?: number | null;
  team_id?: number | null;
  /** 0/1 — pinned announcements sort to the top. */
  is_pinned?: number;
  /** When the announcement goes live (scheduled announcements start unpublished). */
  scheduled_at?: string | null;
  /** 0/1 — scheduled announcements are 0 until the server flips them live. */
  is_published?: number;
  published_at?: string | null;
  title: string;
  content: string;
  created_by: number;
  creator_first_name?: string;
  creator_last_name?: string;
  department_name?: string;
  team_name?: string;
  created_at?: string;
  updated_at?: string;
  /** How many recipients marked this announcement as read. */
  read_count?: number;
  /** Size of the target audience. */
  total_recipients?: number;
  /** 0/1 — whether the current user has read this announcement. */
  is_read?: number;
}

export interface AnnouncementReader {
  id: number;
  announcement_id: number;
  user_id: number;
  read_at: string;
  first_name?: string;
  last_name?: string;
  job_title?: string | null;
}

export interface CreateAnnouncementData {
  title: string;
  content: string;
  scope?: AnnouncementScope;
  department_id?: number | null;
  team_id?: number | null;
  is_pinned?: boolean | number;
  scheduled_at?: string | null;
}

export const AnnouncementModel = {
  getAll: () =>
    api.get<{ success: boolean; data: { announcements: Announcement[] } }>(
      '/announcements',
    ),
  get: (id: number) =>
    api.get<{ success: boolean; data: { announcement: Announcement } }>(
      `/announcements/${id}`,
    ),
  create: (data: CreateAnnouncementData) =>
    api.post<{ success: boolean; data: { announcement: Announcement } }>(
      '/announcements',
      data,
    ),
  update: (id: number, data: Partial<CreateAnnouncementData>) =>
    api.patch<{ success: boolean; data: { announcement: Announcement } }>(
      `/announcements/${id}`,
      data,
    ),
  remove: (id: number) =>
    api.delete<{ success: boolean; message: string }>(`/announcements/${id}`),
  markRead: (id: number) =>
    api.post<{ success: boolean; data: { announcement: Announcement } }>(
      `/announcements/${id}/read`,
    ),
  getReads: (id: number) =>
    api.get<{
      success: boolean;
      data: { readers: AnnouncementReader[]; total_recipients: number };
    }>(`/announcements/${id}/reads`),
};