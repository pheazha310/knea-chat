// Company domain model — MVVM Model layer.
// Holds the `Company` entity plus `CompanyModel`, the data access for the
// /companies (organization) endpoints.
import api from '../services/api';
import type { User } from './User';

export interface Company {
  id: number;
  name: string;
  domain?: string | null;
  logo?: string | null;
  user_count?: number;
  active_user_count?: number;
  admin_count?: number;
  team_count?: number;
  channel_count?: number;
  plan_key?: string;
  plan_status?: string;
  plan_expires_at?: string | null;
  billing_email?: string | null;
  created_at?: string;
  updated_at?: string;
}

export const CompanyModel = {
  getAll: (params?: Record<string, string | number>) =>
    api.get<{ success: boolean; data: { companies: Company[] } }>('/companies', {
      params,
    }),
  get: (id: number) =>
    api.get<{ success: boolean; data: { company: Company } }>(`/companies/${id}`),
  create: (data: { name: string; domain?: string; logo?: string }) =>
    api.post<{ success: boolean; data: { company: Company } }>('/companies', data),
  update: (id: number, data: Partial<Company>) =>
    api.patch<{ success: boolean; data: { company: Company } }>(
      `/companies/${id}`,
      data,
    ),
  remove: (id: number) =>
    api.delete<{ success: boolean; message: string }>(`/companies/${id}`),
  getUsers: (id: number, role?: string) =>
    api.get<{ success: boolean; data: { users: User[] } }>(`/companies/${id}/users`, {
      params: role ? { role } : {},
    }),
  getAdmins: (id: number) =>
    api.get<{ success: boolean; data: { admins: User[] } }>(`/companies/${id}/admins`),
};
