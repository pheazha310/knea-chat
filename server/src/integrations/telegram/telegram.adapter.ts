/**
 * TelegramChannelAdapter — the Telegram side of the omni-channel contract.
 *
 * Owns everything Telegram-specific: update parsing (text + media), media
 * download through Telegram's file server, outbound delivery, health and
 * webhook administration. Everything else (contact/conversation/message
 * persistence, notifications, WebSocket fan-out) is handled generically by
 * OmniChannelService.
 */
import type { TelegramService } from './telegram.service';
import { TelegramApiError } from './telegram.service';
import type {
  TelegramMessage,
  TelegramUpdate,
} from './telegram.types';
import type {
  ChannelAdapter,
  OmniHealthResult,
  OmniInboundMessage,
  OmniMedia,
  OmniOutboundResult,
} from '../omni/omni.types';

/** Media attachment extracted from a Telegram message (text + media supported). */
interface MediaAttachment {
  kind: 'image' | 'voice' | 'file';
  fileId: string;
  fileName: string;
  mimeType: string | null;
}

/** Pick the media attachment from a message, or null when it is text-only. */
const extractMedia = (message: TelegramMessage): MediaAttachment | null => {
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo.reduce((a, b) =>
      b.width * b.height > a.width * a.height ? b : a,
    );
    return {
      kind: 'image',
      fileId: largest.file_id,
      fileName: `photo_${message.message_id}.jpg`,
      mimeType: 'image/jpeg',
    };
  }
  if (message.voice) {
    return {
      kind: 'voice',
      fileId: message.voice.file_id,
      fileName: `voice_${message.message_id}.ogg`,
      mimeType: message.voice.mime_type || 'audio/ogg',
    };
  }
  if (message.document) {
    return {
      kind: 'file',
      fileId: message.document.file_id,
      fileName: message.document.file_name || `document_${message.message_id}`,
      mimeType: message.document.mime_type || null,
    };
  }
  if (message.video) {
    return {
      kind: 'file',
      fileId: message.video.file_id,
      fileName: message.video.file_name || `video_${message.message_id}.mp4`,
      mimeType: message.video.mime_type || 'video/mp4',
    };
  }
  if (message.audio) {
    return {
      kind: 'file',
      fileId: message.audio.file_id,
      fileName: message.audio.file_name || `audio_${message.message_id}`,
      mimeType: message.audio.mime_type || null,
    };
  }
  if (message.animation) {
    return {
      kind: 'file',
      fileId: message.animation.file_id,
      fileName: message.animation.file_name || `animation_${message.message_id}.gif`,
      mimeType: message.animation.mime_type || 'image/gif',
    };
  }
  if (message.sticker) {
    return {
      kind: 'file',
      fileId: message.sticker.file_id,
      fileName: `sticker_${message.message_id}.webp`,
      mimeType: 'image/webp',
    };
  }
  return null;
};

export class TelegramChannelAdapter implements ChannelAdapter {
  readonly channel = 'telegram';

  constructor(private api: TelegramService) {}

  /** Parse a Telegram update into normalized inbound messages ([] = ignore). */
  async parseInbound(payload: unknown): Promise<OmniInboundMessage[]> {
    const update = payload as TelegramUpdate | null;
    const message = update?.message;
    if (!message) {
      // edited_message / channel_post / callback_query / … are unsupported —
      // acknowledge silently so Telegram does not retry them forever.
      return [];
    }

    if (!message.from) {
      console.warn(`[telegram] Ignoring update ${update?.update_id}: missing sender`);
      return [];
    }
    if (!message.chat || !message.chat.id) {
      console.warn(`[telegram] Ignoring update ${update?.update_id}: missing chat`);
      return [];
    }

    const media = extractMedia(message);
    const text = message.text || '';
    if (!media && !text) {
      // Non-text, non-media message kinds (polls, locations, …) are ignored.
      console.log(`[telegram] Ignoring unsupported message ${message.message_id}`);
      return [];
    }

    return [
      {
        externalContactId: String(message.from.id),
        username: message.from.username || null,
        firstName: message.from.first_name || null,
        lastName: message.from.last_name || null,
        externalMessageId: String(message.message_id),
        content: media
          ? (message.caption || message.text || media.fileName).trim()
          : text,
        media: media
          ? { kind: media.kind, fileName: media.fileName, mimeType: media.mimeType, fileRef: media.fileId }
          : null,
        externalTimestamp: new Date(message.date * 1000),
        metadata: { telegram: { message_id: message.message_id, date: message.date } },
      },
    ];
  }

  /** Download media bytes for a Telegram file_id (or null when unavailable). */
  async downloadMedia(media: OmniMedia): Promise<Buffer | null> {
    try {
      const info = await this.api.getFile(media.fileRef);
      if (!info.ok || !info.result?.file_path) {
        console.warn(
          `[telegram] Could not resolve file ${media.fileRef}: ${info.description || 'unknown error'}`,
        );
        return null;
      }
      return await this.api.downloadFile(info.result.file_path);
    } catch (error) {
      console.error('[telegram] Media download failed:', (error as Error).message);
      return null;
    }
  }

  /** Send an outbound text message through the Telegram Bot API. */
  async sendMessage(
    chatId: number,
    text: string,
    options: { replyToExternalMessageId?: string | null } = {},
  ): Promise<OmniOutboundResult> {
    try {
      const sendOptions: { reply_to_message_id?: number } = {};
      if (options.replyToExternalMessageId) {
        const replyId = Number(options.replyToExternalMessageId);
        if (Number.isFinite(replyId) && replyId > 0) {
          sendOptions.reply_to_message_id = replyId;
        }
      }
      const sent = await this.api.sendMessage(chatId, text, sendOptions);
      if (!sent.ok) {
        return {
          ok: false,
          description: sent.description,
          errorCode: sent.error_code,
        };
      }
      return {
        ok: true,
        externalMessageId: sent.result?.message_id ? String(sent.result.message_id) : null,
      };
    } catch (error) {
      if (error instanceof TelegramApiError) {
        return { ok: false, description: error.message, errorCode: error.errorCode };
      }
      return { ok: false, description: 'Telegram delivery failed' };
    }
  }

  /** Health: token configured + bot authenticates with the API. */
  async getHealth(): Promise<OmniHealthResult> {
    if (!this.api.isConfigured()) {
      return { connected: false };
    }
    try {
      const result = await this.api.getMe();
      if (result.ok && result.result) {
        return {
          connected: true,
          info: { bot: { id: result.result.id, username: result.result.username } },
        };
      }
      return { connected: false };
    } catch (error) {
      console.error('[telegram] Health check error:', (error as Error).message);
      return { connected: false };
    }
  }

  async setupWebhook(webhookUrl: string): Promise<unknown> {
    return this.api.setWebhook(webhookUrl);
  }

  async getWebhookInfo(): Promise<unknown> {
    return this.api.getWebhookInfo();
  }

  async deleteWebhook(): Promise<unknown> {
    return this.api.deleteWebhook();
  }
}

export default TelegramChannelAdapter;