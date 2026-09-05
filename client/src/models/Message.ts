// Message domain model — MVVM Model layer.
// Holds the message-related entities (Message, WsMessage, ChatMessage,
// Reaction, Attachment) plus `MessageModel`, the data access for the
// /messages endpoints.
import api, { API_BASE_URL } from '../services/api';
import type { PresenceStatus } from './User';

export type MessageType = 'text' | 'image' | 'file' | 'voice' | 'system';

export interface Reaction {
  id: number;
  message_id: number;
  user_id: number;
  reaction: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  profile_picture?: string | null;
  created_at?: string;
}

export interface Attachment {
  id: number;
  message_id: number;
  file_name: string;
  file_url: string;
  file_type?: string | null;
  file_size?: number | null;
  uploaded_at?: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  type: MessageType;
  reply_to?: number | null;
  forwarded_from?: number | null;
  is_pinned?: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  first_name?: string;
  last_name?: string;
  email?: string;
  profile_picture?: string | null;
  status?: PresenceStatus;
  reactions?: Reaction[];
  attachments?: Attachment[];
}

/**
 * WebSocket-serialized message shape (server/src/websocket/message.utils.js).
 */
export interface WsMessage {
  id: number;
  conversationId: number;
  senderId: number;
  senderEmail?: string;
  senderFirstName?: string;
  senderLastName?: string;
  senderProfilePicture?: string | null;
  content: string;
  messageType: MessageType;
  replyTo?: number | null;
  forwardedFrom?: number | null;
  createdAt: string;
  updatedAt: string;
  reactions?: Reaction[];
  attachments?: Attachment[];
  isPinned?: boolean;
  mentionedUserIds?: number[];
  deletedAt?: string | null;
}

/**
 * Union of REST (snake_case) and WebSocket (camelCase) message shapes.
 * The store's message cache holds both depending on the source.
 */
export type ChatMessage = Message | WsMessage;

export const MessageModel = {
  send: (data: {
    conversation_id: number;
    content: string;
    type?: string;
    reply_to?: number;
  }) => api.post<{ success: boolean; data: { message: Message } }>('/messages', data),
  update: (id: number, content: string) =>
    api.patch<{ success: boolean; data: { message: Message } }>(
      `/messages/${id}`,
      { content },
    ),
  remove: (id: number) =>
    api.delete<{ success: boolean; message: string }>(`/messages/${id}`),
  pin: (id: number) =>
    api.post<{ success: boolean; data: { message: Message } }>(`/messages/${id}/pin`),
  unpin: (id: number) =>
    api.delete<{ success: boolean; data: { message: Message } }>(`/messages/${id}/pin`),
  getThread: (messageId: number, page = 1, limit = 30) =>
    api.get<{ success: boolean; data: { parent: Message; replies: Message[]; pagination: any } }>(
      `/messages/${messageId}/thread?page=${page}&limit=${limit}`,
    ),
  /** One full message (+ sender, reactions, attachments, conversation). */
  getById: (id: number) =>
    api.get<{
      success: boolean;
      data: {
        message: Message;
        conversation: { id: number; type: string; name: string | null };
      };
    }>(`/messages/${id}`),
  upload: (conversationId: number, file: File, onProgress?: (pct: number) => void) => {
    const formData = new FormData();
    formData.append('conversation_id', String(conversationId));
    formData.append('file', file);
    return api.post<{ success: boolean; data: { message: Message } }>(
      '/messages/upload',
      formData,
      {
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      },
    );
  },
  addReaction: (id: number, reaction: string) =>
    api.post<{ success: boolean; data: { reactions: Reaction[] } }>(
      `/messages/${id}/reactions`,
      { reaction },
    ),
  removeReaction: (id: number, reaction: string) =>
    api.delete<{ success: boolean; data: { reactions: Reaction[] } }>(
      `/messages/${id}/reactions/${encodeURIComponent(reaction)}`,
    ),
  bookmark: (messageId: number) =>
    api.post<{ success: boolean; data: { bookmark: any } }>(
      `/messages/${messageId}/bookmarks`,
    ),
  unbookmark: (messageId: number) =>
    api.delete<{ success: boolean; data: { removed: boolean } }>(
      `/messages/${messageId}/bookmarks`,
    ),
  getBookmarks: (page = 1, limit = 20) =>
    api.get<{ success: boolean; data: { bookmarks: any[]; pagination: any } }>(
      `/bookmarks?page=${page}&limit=${limit}`,
    ),
  setReminder: (messageId: number) =>
    api.post<{ success: boolean; data: { reminderId: number; remind_at: string } }>(
      `/messages/${messageId}/remind`,
    ),
  cancelReminder: (messageId: number) =>
    api.delete<{ success: boolean; data: { removed: boolean } }>(`/messages/${messageId}/remind`),
  getReminder: (messageId: number) =>
    api.get<{ success: boolean; data: { id: number; remind_at: string } | null }>(`/messages/${messageId}/remind`),
};

/** Resolve an absolute URL for an uploaded file (SRS FR-17). */
export const resolveFileUrl = (fileUrl: string) => {
  if (/^https?:\/\//.test(fileUrl)) return fileUrl;
  const origin = API_BASE_URL.replace(/\/api$/, '');
  return `${origin}${fileUrl}`;
};
