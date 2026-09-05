/**
 * Announcement types — mirror the `announcements` table plus the creator
 * name columns joined by the list query.
 *
 * Since migration 022 an announcement is targeted (scope company/department/
 * team), optionally pinned, optionally scheduled, and its read progress is
 * computed per viewer (read_count / total_recipients / is_read).
 */

export type AnnouncementScope = 'company' | 'department' | 'team';

export interface AnnouncementRow {
  id: number;
  company_id: number;
  scope: AnnouncementScope;
  department_id: number | null;
  team_id: number | null;
  is_pinned: number;
  scheduled_at: Date | string | null;
  is_published: number;
  published_at: Date | string | null;
  title: string;
  content: string;
  created_by: number;
  created_at: Date | string;
  updated_at: Date | string;
  creator_first_name?: string;
  creator_last_name?: string;
  department_name?: string;
  team_name?: string;
  /** Number of recipients who marked this announcement as read. */
  read_count?: number;
  /** Size of the target audience (company users / department users / team members). */
  total_recipients?: number;
  /** 1 when the current viewer has read this announcement (viewer-scoped). */
  is_read?: number;
  /** Emoji reactions on this announcement (announcement_reactions). */
  reactions?: AnnouncementReactionRow[];
}

/** One row of the announcement_reactions ledger (migration 025). */
export interface AnnouncementReactionRow {
  id: number;
  announcement_id: number;
  user_id: number;
  reaction: string;
  created_at: Date | string;
  first_name?: string;
  last_name?: string;
  email?: string;
  profile_picture?: string | null;
}

/** One row of the read-confirmation ledger (who read what, and when). */
export interface AnnouncementReadRow {
  id: number;
  announcement_id: number;
  user_id: number;
  read_at: Date | string;
  first_name?: string;
  last_name?: string;
  job_title?: string | null;
}

export interface CreateAnnouncementData {
  company_id: number;
  created_by: number;
  title: string;
  content: string;
  scope?: AnnouncementScope;
  department_id?: number | null;
  team_id?: number | null;
  is_pinned?: number | boolean;
  scheduled_at?: Date | string | null;
}