/**
 * Telegram Bot API types (subset used by KneaChat's Telegram integration).
 *
 * Field names follow the Telegram Bot API wire format (snake_case) so update
 * payloads can be used directly. Only the fields the integration reads are
 * modeled; unsupported update kinds are ignored rather than typed.
 */

/** A Telegram user (the `from` of a message, or a bot). */
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/** A Telegram chat (private, group, supergroup or channel). */
export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/** One size of a photo attachment. */
export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

/** Voice note. */
export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

/** Generic document / video / audio / animation / sticker. */
export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/** A Telegram message — text and/or media attachments. */
export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  /** Unix timestamp (seconds). */
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  voice?: TelegramVoice;
  video?: TelegramDocument;
  document?: TelegramDocument;
  audio?: TelegramDocument;
  animation?: TelegramDocument;
  sticker?: TelegramDocument;
  /** Sender of the reply target (filled in for agent replies). */
  sender_chat?: TelegramChat;
}

/**
 * A Telegram update. Only `message` (private-chat text messages) is handled;
 * every other kind (edited_message, channel_post, callback_query, …) is
 * intentionally ignored by the webhook.
 */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  [key: string]: unknown;
}

/** Result of getFile — where a media file lives on Telegram's servers. */
export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

/** Result of getMe — the bot's own identity. */
export interface TelegramBot {
  id: number;
  is_bot: boolean;
  first_name: string;
  username: string;
}

/** Standard Telegram Bot API response envelope. */
export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/** Result of getWebhookInfo. */
export interface TelegramWebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  last_success_date?: number;
  last_success_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
}