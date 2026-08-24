/**
 * Bookmark types — mirror the `message_bookmarks` table.
 */
export interface BookmarkRow {
  id: number;
  message_id: number;
  user_id: number;
  created_at: Date | string;
}

export interface CreateBookmarkData {
  message_id: number;
  user_id: number;
}

export interface BookmarkFilters {
  userId: number;
  page?: number;
  limit?: number;
}
