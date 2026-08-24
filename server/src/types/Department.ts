/**
 * Department types — mirror the `departments` table plus the aggregate user
 * count computed by the list query.
 */

export interface DepartmentRow {
  id: number;
  company_id: number;
  name: string;
  description: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  /** Number of users assigned to this department (list query only). */
  user_count?: number;
}
