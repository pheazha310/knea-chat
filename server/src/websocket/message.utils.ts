/**
 * Shared serialization for message events so the REST and WebSocket paths
 * emit identical shapes to clients.
 */
import type { OutgoingMessage } from '../types';

export interface SerializedMessage {
  id: number;
  conversationId: number;
  senderId: number;
  senderEmail?: string;
  senderFirstName?: string;
  senderLastName?: string;
  senderProfilePicture?: string | null;
  content: string;
  messageType: string;
  replyTo: number | null;
  forwardedFrom: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  reactions: unknown[];
  attachments: unknown[];
  isPinned: boolean;
  mentionedUserIds: number[];
  deletedAt: Date | string | null;
}

export const serializeMessage = (message: OutgoingMessage): SerializedMessage => ({
  id: message.id,
  conversationId: message.conversation_id,
  senderId: message.sender_id,
  senderEmail: message.email,
  senderFirstName: message.first_name,
  senderLastName: message.last_name,
  senderProfilePicture: message.profile_picture,
  content: message.content,
  messageType: message.type,
  replyTo: message.reply_to,
  forwardedFrom: message.forwarded_from ?? null,
  createdAt: message.created_at,
  updatedAt: message.updated_at,
  reactions: message.reactions || [],
  attachments: message.attachments || [],
  isPinned: !!message.is_pinned,
  mentionedUserIds: message.mentionedUserIds || [],
  deletedAt: message.deleted_at,
});
