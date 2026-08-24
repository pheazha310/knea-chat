// Team domain model — MVVM Model layer.
// Holds the `Team` entity plus `TeamModel`, the data access for the /teams
// endpoints.
import api from '../services/api';
import type { User } from './User';

export interface Team {
  id: number;
  company_id: number;
  department_id?: number | null;
  name: string;
  description?: string | null;
  created_by: number;
  member_count?: number;
  manager_first_name?: string;
  manager_last_name?: string;
  /** The current user's role inside this team ('leader' | 'member'), if any. */
  user_role?: string;
  created_at?: string;
  updated_at?: string;
}

export const TeamModel = {
  getAll: () =>
    api.get<{ success: boolean; data: { teams: Team[] } }>('/teams'),
  get: (id: number) =>
    api.get<{ success: boolean; data: { team: Team } }>(`/teams/${id}`),
  create: (data: {
    name: string;
    description?: string;
    department_id?: number | null;
    member_ids?: number[];
  }) => api.post<{ success: boolean; data: { team: Team } }>('/teams', data),
  update: (id: number, data: { name?: string; description?: string }) =>
    api.patch<{ success: boolean; data: { team: Team } }>(`/teams/${id}`, data),
  remove: (id: number) =>
    api.delete<{ success: boolean; message: string }>(`/teams/${id}`),
  getMembers: (id: number) =>
    api.get<{ success: boolean; data: { members: User[] } }>(`/teams/${id}/members`),
  addMember: (id: number, userId: number, role = 'member') =>
    api.post<{ success: boolean; message: string }>(`/teams/${id}/members`, {
      user_id: userId,
      role,
    }),
  removeMember: (id: number, userId: number) =>
    api.delete<{ success: boolean; message: string }>(`/teams/${id}/members/${userId}`),
};
