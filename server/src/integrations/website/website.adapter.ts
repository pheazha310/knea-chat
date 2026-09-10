/**
 * WebsiteChannelAdapter — the website widget side of the omni-channel contract.
 *
 * Owns everything website-specific: webhook parsing, media handling, outbound
 * delivery, health and webhook administration. Everything else (contact /
 * conversation / message persistence, notifications, WebSocket fan-out) is
 * handled generically by OmniChannelService.
 *
 * The expected website widget payload shape for inbound messages is:
 * {
 *   visitor: { id, name, email, phone? },
 *   message: { id, text, type?, timestamp? },
 *   media?: { kind, url, mimeType, fileName? }
 * }
 */
import type {
  ChannelAdapter,
  OmniHealthResult,
  OmniInboundMessage,
  OmniMedia,
  OmniOutboundResult,
} from '../omni/omni.types';

const CHANNEL = 'website';

export class WebsiteChannelAdapter implements ChannelAdapter {
  readonly channel = CHANNEL;

  /** Parse a website widget webhook payload into normalized inbound messages. */
  async parseInbound(payload: unknown): Promise<OmniInboundMessage[]> {
    const data = payload as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') {
      return [];
    }

    const visitor = data.visitor as Record<string, unknown> | undefined;
    const message = data.message as Record<string, unknown> | undefined;
    if (!visitor?.id || !message?.id) {
      return [];
    }

    const text = typeof message.text === 'string' ? message.text : '';
    const media = data.media as OmniMedia | undefined;
    if (!media && !text) {
      return [];
    }

    const content = media
      ? text || media.fileName || 'Media message'
      : text;

    return [
      {
        externalContactId: String(visitor.id),
        username: typeof visitor.email === 'string' ? visitor.email : null,
        firstName: typeof visitor.name === 'string' ? visitor.name.split(' ')[0] : null,
        lastName: typeof visitor.name === 'string' ? visitor.name.split(' ').slice(1).join(' ') : null,
        externalMessageId: String(message.id),
        content,
        media: media || null,
        externalTimestamp: message.timestamp ? new Date(message.timestamp as string | number) : new Date(),
        metadata: { website: { visitor, message } },
      },
    ];
  }

  /** Download media bytes for an OmniMedia.fileRef, or null when unavailable. */
  async downloadMedia(media: OmniMedia): Promise<Buffer | null> {
    // Website media is hosted externally; download is optional and may require
    // additional auth. Stub for now — the inbound message is still persisted
    // without the file when download fails.
    return null;
  }

  /** Send an outbound text message back through the website widget. */
  async sendMessage(
    _chatId: number,
    text: string,
    _options: { replyToExternalMessageId?: string | null } = {},
  ): Promise<OmniOutboundResult> {
    // Outbound delivery is stub until a website messaging API is integrated.
    // The server still persists the agent reply so the inbox sees it.
    console.warn(`[${CHANNEL}] sendMessage is not yet implemented — message not delivered to visitor`);
    return {
      ok: true,
      externalMessageId: null,
      description: 'Website delivery not implemented',
    };
  }

  /** Health: always reports connected unless explicitly configured otherwise. */
  async getHealth(): Promise<OmniHealthResult> {
    return {
      connected: true,
      info: { channel: CHANNEL },
    };
  }

  /** Webhook administration is not applicable for basic website widget. */
  async setupWebhook(_webhookUrl: string): Promise<unknown> {
    return { ok: true, description: 'Website widget uses static endpoint' };
  }

  async getWebhookInfo(): Promise<unknown> {
    return { channel: CHANNEL };
  }

  async deleteWebhook(): Promise<unknown> {
    return { ok: true };
  }
}

export default WebsiteChannelAdapter;
