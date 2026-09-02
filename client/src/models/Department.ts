// Department domain model — MVVM Model layer.
// Holds the `Department` entity plus `DepartmentModel`, the data access for
// the /departments endpoints.
import api from '../services/api';

export interface Department {
  id: number;
  company_id: number;
  name: string;
  description?: string | null;
  /** Number of users assigned to this department (list query). */
  user_count?: number;
  created_at?: string;
  updated_at?: string;
}

export const DepartmentModel = {
  getAll: () =>
    api.get<{ success: boolean; data: { departments: Department[] } }>(
      '/departments',
    ),
  get: (id: number) =>
    api.get<{ success: boolean; data: { department: Department } }>(
      `/departments/${id}`,
    ),
  create: (data: { name: string; description?: string }) =>
    api.post<{ success: boolean; data: { department: Department } }>(
      '/departments',
      data,
    ),
  update: (id: number, data: { name?: string; description?: string | null }) =>
    api.patch<{ success: boolean; data: { department: Department } }>(
      `/departments/${id}`,
      data,
    ),
  remove: (id: number) =>
    api.delete<{ success: boolean; message: string }>(`/departments/${id}`),
};
