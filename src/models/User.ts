// User domain model — MVVM Model layer.
// Holds the `User` entity (and related types) plus `UserModel`, the data
// access for the /users and /search/users endpoints.
import api from '../services/api';

export type Role = 'super_admin' | 'admin' | 'manager' | 'employee';
export type PresenceStatus = 'online' | 'offline' | 'away' | 'dnd';

export interface User {
  id: number;
  company_id?: number;
  department_id?: number | null;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  job_title?: string | null;
  profile_picture?: string | null;
  status: PresenceStatus;
  is_active?: number;
  last_seen_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ConversationMember {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  job_title?: string | null;
  status: PresenceStatus;
  profile_picture?: string | null;
  conv_role?: 'admin' | 'member';
  joined_at?: string;
}

export const UserModel = {
  getAll: (params?: Record<string, string | number>) =>
    api.get<{ success: boolean; data: { users: User[] } }>('/users', { params }),
  get: (id: number) =>
    api.get<{ success: boolean; data: { user: User } }>(`/users/${id}`),
  create: (data: {
    first_name: string;
    last_name: string;
    email: string;
    password: string;
    role?: string;
    job_title?: string;
    department_id?: number | null;
  }) =>
    api.post<{ success: boolean; data: { user: User } }>('/users', data),
  update: (id: number, data: Partial<User>) =>
    api.patch<{ success: boolean; data: { user: User } }>(`/users/${id}`, data),
  remove: (id: number) =>
    api.delete<{ success: boolean; message: string }>(`/users/${id}`),
  uploadAvatar: (id: number, file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.post<{ success: boolean; message: string; data: { user: User } }>(
      `/users/${id}/avatar`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
  },
  search: (q: string) =>
    api.get<{ success: boolean; data: { results: User[] } }>(
      `/search/users?q=${encodeURIComponent(q)}`,
    ),
};
