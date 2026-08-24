/** Company types — mirror the `companies` table plus admin-console aggregates. */

export interface CompanyRow {
  id: number;
  name: string;
  domain: string | null;
  logo: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  user_count?: number;
  active_user_count?: number;
  admin_count?: number;
  team_count?: number;
  channel_count?: number;
}

export interface Company extends CompanyRow {}

export interface CreateCompanyData {
  name: string;
  domain?: string | null;
  logo?: string | null;
}

export interface CompanyFilters {
  search?: string;
}
