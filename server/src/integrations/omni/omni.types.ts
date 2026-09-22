/**
 * Omni-channel adapter contract.
 *
 * Every external channel (Telegram, website widget, WhatsApp, email, …) plugs
 * into KneaChat through a `ChannelAdapter`. The channel adapter owns the
 * provider-specific work (parsing webhook payloads, downloading media, sending
 * outbound messages, health checks) while the generic engine
 * (`OmniChannelService`) owns everything else: external contact /
 * conversation / message persistence, duplicate prevention, notifications and
 * WebSocket fan-out — all shared across channels.
 */

/** Normalized media attachment on an inbound message. */
export interface OmniMedia {
  kind: 'image' | 'voice' | 'file';
  fileName: string;
  mimeType: string | null;
  /** Provider-side file reference (e.g. a Telegram file_id). */
  fileRef: string;
}

/** A normalized inbound message, ready for the generic engine to persist. */
export interface OmniInboundMessage {
  /** Provider-side contact id (e.g. Telegram user id). Never an internal id. */
  externalContactId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Provider-side message id — the duplicate-detection key. */
  externalMessageId: string;
  /** Text content (or caption / file name for media messages). */
  content: string;
  /**
   * All files carried by one inbound provider message. `media` remains the
   * primary file for backwards compatibility with single-file channels.
   */
  attachments?: OmniMedia[] | null;
  media?: OmniMedia | null;
  externalTimestamp?: Date | string | null;
  metadata?: unknown;
}

/**
 * Inbound thread hints (email only): the RFC 5322 headers that tie a new
 * inbound email to an existing conversation. The engine matches them against
 * the external message ledger; a null/empty set falls back to the channel's
 * default conversation grouping (one conversation per contact).
 */
export interface OmniThreadHints {
  /** Message-IDs referenced by the inbound email: In-Reply-To + References. */
  inReplyToMessageIds: string[];
}

/**
 * Outbound reply threading hints (email only — other channels ignore them).
 * `subject` is the original conversation subject (the adapter adds the `Re:`
 * prefix); `inReplyTo`/`references` are the customer's Message-ID chain so
 * the reply threads correctly in the customer's mail client.
 */
export interface OmniOutboundThreading {
  subject?: string | null;
  inReplyTo?: string | null;
  references?: string[] | null;
}

/** Binary media an agent sends outbound through a channel adapter. */
export interface OmniOutboundMedia {
  kind: 'image' | 'voice' | 'file';
  buffer: Buffer;
  fileName: string;
  mimeType: string | null;
  /** Optional caption carried along with the file (channel length limits apply). */
  caption?: string | null;
}

/** Result of a channel's outbound send. */
export interface OmniOutboundResult {
  ok: boolean;
  externalMessageId?: string | null;
  description?: string;
  errorCode?: number;
}

/** Health probe result (provider-specific info is optional). */
export interface OmniHealthResult {
  connected: boolean;
  info?: Record<string, unknown>;
}

/**
 * Contract every channel adapter implements. Optional members (`downloadMedia`,
 * webhook administration) are only present when the channel supports them.
 */
export interface ChannelAdapter {
  /** Channel key stored in the external_* tables (e.g. 'telegram'). */
  readonly channel: string;

  /** Parse a raw webhook payload into normalized inbound messages ([] = ignore). */
  parseInbound(payload: unknown): Promise<OmniInboundMessage[]>;

  /**
   * Optional thread hints for an already-parsed inbound message: provider
   * headers that tie it to an existing conversation (email In-Reply-To /
   * References). Channels without threading omit it — the engine then keeps
   * its default conversation grouping.
   */
  getThreadHints?(message: OmniInboundMessage): Promise<OmniThreadHints | null>;

  /** Download media bytes for an OmniMedia.fileRef, or null when unavailable. */
  downloadMedia?(media: OmniMedia): Promise<Buffer | null>;

  /** Send an outbound text message to the contact's chat. */
  sendMessage(
    chatId: string | number,
    text: string,
    options?: { replyToExternalMessageId?: string | null; threading?: OmniOutboundThreading | null },
  ): Promise<OmniOutboundResult>;

  /**
   * Optional file/voice delivery — only channels that can relay media
   * implement it (Telegram does through sendPhoto/sendVoice/sendDocument;
   * the engine answers 400 "does not support media delivery" when absent).
   */
  sendMedia?(
    chatId: string | number,
    media: OmniOutboundMedia,
    options?: { replyToExternalMessageId?: string | null; threading?: OmniOutboundThreading | null },
  ): Promise<OmniOutboundResult>;

  /** Channel health: configured + reachable? */
  getHealth(): Promise<OmniHealthResult>;

  /** Optional webhook administration. */
  setupWebhook?(webhookUrl: string): Promise<unknown>;
  getWebhookInfo?(): Promise<unknown>;
  deleteWebhook?(): Promise<unknown>;
}
