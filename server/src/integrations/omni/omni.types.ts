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
  media?: OmniMedia | null;
  externalTimestamp?: Date | string | null;
  metadata?: unknown;
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

  /** Download media bytes for an OmniMedia.fileRef, or null when unavailable. */
  downloadMedia?(media: OmniMedia): Promise<Buffer | null>;

  /** Send an outbound text message to the contact's chat. */
  sendMessage(
    chatId: number,
    text: string,
    options?: { replyToExternalMessageId?: string | null },
  ): Promise<OmniOutboundResult>;

  /** Channel health: configured + reachable? */
  getHealth(): Promise<OmniHealthResult>;

  /** Optional webhook administration. */
  setupWebhook?(webhookUrl: string): Promise<unknown>;
  getWebhookInfo?(): Promise<unknown>;
  deleteWebhook?(): Promise<unknown>;
}