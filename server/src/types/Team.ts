/** Team types — mirror the `teams`/`team_members` tables. */

export interface TeamRow {
  id: number;
  company_id: number;
  name: string;
  description: string | null;
  created_by: number;
  department_id: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  manager_first_name?: string;
  manager_last_name?: string;
  member_count?: number;
  /** The requester's role inside this team ('leader' | 'member'), if any. */
  user_role?: string;
}

export interface Team extends TeamRow {}

export interface TeamMemberRow {
  id: number;
  team_id: number;
  user_id: number;
  role: string;
  joined_at: Date | string;
  first_name?: string;
  last_name?: string;
  email?: string;
  job_title?: string | null;
  status?: string;
  profile_picture?: string | null;
  team_role?: string;
}

export interface CreateTeamData {
  company_id: number;
  name: string;
  description?: string | null;
  created_by: number;
  department_id?: number | null;
}

export interface TeamFilters {
  companyId: number;
  page?: number;
  limit?: number;
  search?: string;
  requesterId?: number;
}
