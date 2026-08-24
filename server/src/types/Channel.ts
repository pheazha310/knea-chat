/** Channel types — mirror the `channels`/`channel_members` tables. */

export interface ChannelRow {
  id: number;
  company_id: number;
  team_id: number | null;
  name: string;
  description: string | null;
  type: string;
  created_by: number;
  is_archived: number;
  created_at: Date | string;
  updated_at: Date | string;
  creator_first_name?: string;
  creator_last_name?: string;
  member_count?: number;
  user_role?: string;
}

export interface Channel extends ChannelRow {}

export interface ChannelMemberRow {
  id: number;
  channel_id: number;
  user_id: number;
  role: string;
  joined_at: Date | string;
  first_name?: string;
  last_name?: string;
  email?: string;
  job_title?: string | null;
  status?: string;
  profile_picture?: string | null;
  channel_role?: string;
}

export interface CreateChannelData {
  company_id: number;
  name: string;
  description?: string | null;
  created_by: number;
  type?: string;
  team_id?: number | null;
}

export interface ChannelFilters {
  companyId: number;
  teamId?: number | string;
  page?: number;
  limit?: number;
  search?: string;
}
