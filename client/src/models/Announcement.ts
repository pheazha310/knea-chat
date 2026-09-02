// Announcement domain model — MVVM Model layer.
// Holds the `Announcement` entity plus `AnnouncementModel`, the data access
// for the /announcements endpoints (SRS FR-24).
import api from '../services/api';

export interface Announcement {
  id: number;
  company_id: number;
  title: string;
  content: string;
  created_by: number;
  creator_first_name?: string;
  creator_last_name?: string;
  created_at?: string;
  updated_at?: string;
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
  create: (data: { title: string; content: string }) =>
    api.post<{ success: boolean; data: { announcement: Announcement } }>(
      '/announcements',
      data,
    ),
  update: (id: number, data: { title?: string; content?: string }) =>
    api.patch<{ success: boolean; data: { announcement: Announcement } }>(
      `/announcements/${id}`,
      data,
    ),
  remove: (id: number) =>
    api.delete<{ success: boolean; message: string }>(`/announcements/${id}`),
};
