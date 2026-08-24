/**
 * Announcement types — mirror the `announcements` table plus the creator
 * name columns joined by the list query.
 */

export interface AnnouncementRow {
  id: number;
  company_id: number;
  title: string;
  content: string;
  created_by: number;
  created_at: Date | string;
  updated_at: Date | string;
  creator_first_name?: string;
  creator_last_name?: string;
}
