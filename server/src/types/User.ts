/**
 * User types — mirror the `users` table (snake_case, as returned by MySQL)
 * so API responses keep their existing shape. `password` is never sent to
 * clients; `User` is the public projection without it.
 */

export interface UserRow {
  id: number;
  company_id: number | null;
  department_id: number | null;
  manager_id: number | null;
  first_name: string;
  last_name: string;
  email: string;
  password?: string | null;
  role: string;
  job_title: string | null;
  profile_picture: string | null;
  status: string;
  is_active: number;
  last_seen_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** Public user shape — never includes the password hash. */
export type User = Omit<UserRow, 'password'>;

export interface CreateUserData {
  company_id: number;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role?: string;
  job_title?: string | null;
  department_id?: number | null;
  manager_id?: number | null;
}

export interface UpdateUserData {
  first_name?: string;
  last_name?: string;
  email?: string;
  job_title?: string;
  profile_picture?: string;
  status?: string;
  department_id?: number | null;
  role?: string;
  is_active?: number;
  manager_id?: number | null;

}

export interface UserFilters {
  companyId: number;
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  department_id?: string;
}
