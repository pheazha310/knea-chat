/**
 * Conversation types — mirror the `conversations`/`conversation_members`
 * tables plus aggregate columns computed by the list query.
 */

export interface ConversationRow {
  id: number;
  type: string;
  created_by: number;
  name: string | null;
  description: string | null;
  is_active: number;
  created_at: Date | string;
  updated_at: Date | string;
  member_count?: number;
  message_count?: number;
  last_message_content?: string | null;
  last_message_at?: Date | string | null;
  /** Omni-channel adapter backing this conversation (e.g. 'telegram'). */
  channel?: string;
  /** Agent assigned to this omni-channel conversation (nullable). */
  assigned_agent_id?: number | null;
  /** Display name of the assigned agent (resolved for inbox rendering). */
  assigned_agent_name?: string | null;
}

export interface ConversationMember {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  job_title: string | null;
  status: string;
  profile_picture: string | null;
  conv_role: string;
  joined_at: Date | string;
}

export interface Conversation extends ConversationRow {
  members?: ConversationMember[];
}

export interface CreateConversationData {
  type: string;
  created_by: number;
  name?: string | null;
  description?: string | null;
}

export interface ConversationFilters {
  userId: number;
  page?: number;
  limit?: number;
  type?: string;
}
