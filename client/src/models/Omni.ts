// Omni-channel domain model — MVVM Model layer.
// Data access for the channel-agnostic /api/omni endpoints used by the Omni
// Inbox (agent replies, assignment, open/close). The Telegram channel keeps
// its own model for its channel-specific endpoints (/api/telegram/*); this
// model is the generic surface shared by every channel.
import api from '../services/api';
import type { Message } from './Message';

/** Per-channel client capabilities advertised by GET /api/omni/capabilities. */
export interface OmniChannelCapabilities {
  [channel: string]: { media: boolean };
}

export const OmniModel = {
  /**
   * Which channels support which outbound features (e.g. `media` — file/voice
   * relay). Read-only and secret-free, so it is fetched without auth concerns
   * beyond the shared axios instance.
   */
  capabilities: () =>
    api.get<{ success: boolean; data: { channels: OmniChannelCapabilities } }>(
      '/omni/capabilities',
    ),
  /** Reply to a customer through the conversation's channel adapter. */
  reply: (conversationId: number, text: string, replyToMessageId?: number) =>
    api.post<{ success: boolean; data: { message: Message } }>(
      `/omni/conversations/${conversationId}/messages`,
      {
        text,
        ...(replyToMessageId ? { replyToMessageId } : {}),
      },
    ),
  /**
   * Send a file / voice note to a customer through the conversation's
   * channel adapter. Multipart form: `file` (+ optional caption/reply).
   */
  replyMedia: (
    conversationId: number,
    file: File,
    options: { caption?: string; replyToMessageId?: number; kind?: 'voice' | 'file' } = {},
    onProgress?: (pct: number) => void,
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    if (options.caption) formData.append('caption', options.caption);
    if (options.replyToMessageId) formData.append('replyToMessageId', String(options.replyToMessageId));
    if (options.kind) formData.append('kind', options.kind);
    return api.post<{ success: boolean; data: { message: Message } }>(
      `/omni/conversations/${conversationId}/media`,
      formData,
      {
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      },
    );
  },
  /** Claim / assign a conversation to an agent (defaults to self). */
  assign: (conversationId: number, agentId?: number) =>
    api.post<{ success: boolean; data: { assignedAgentId: number | null } }>(
      `/omni/conversations/${conversationId}/assign`,
      agentId ? { agentId } : {},
    ),
  /** Unassign the agent from a conversation. */
  unassign: (conversationId: number) =>
    api.delete<{ success: boolean; data: { assignedAgentId: number | null } }>(
      `/omni/conversations/${conversationId}/assign`,
    ),
  /** Open / close a conversation in the inbox. */
  setStatus: (conversationId: number, status: 'open' | 'closed') =>
    api.patch<{ success: boolean; data: { conversationId: number; status: 'open' | 'closed' } }>(
      `/omni/conversations/${conversationId}/status`,
      { status },
    ),
};