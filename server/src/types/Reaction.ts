/** Reaction types — mirror the `message_reactions` table. */

export interface ReactionRow {
  id: number;
  message_id: number;
  user_id: number;
  reaction: string;
  created_at: Date | string;
  // Joined user columns
  first_name?: string;
  last_name?: string;
  email?: string;
  profile_picture?: string | null;
}
