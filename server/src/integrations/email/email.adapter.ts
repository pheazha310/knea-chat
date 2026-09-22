/**
 * EmailChannelAdapter — the email side of the omni-channel contract.
 *
 * Owns everything email-specific:
 *   - Inbound: webhook payload parsing + normalization
 *   - Outbound: SMTP delivery (text, HTML, attachments)
 *   - Threading: Message-ID / In-Reply-To / References
 *   - Security: HTML sanitization, webhook signature verification
 *
 * The generic engine (OmniChannelService) owns contact/conversation/message
 * persistence, duplicate prevention, notifications and WebSocket fan-out.
 */
import { EmailService, normalizeMessageId, type ResendEmailContent } from './email.service';
import type {
  ChannelAdapter,
  OmniHealthResult,
  OmniInboundMessage,
  OmniMedia,
  OmniOutboundMedia,
  OmniOutboundResult,
  OmniThreadHints,
} from '../omni/omni.types';
import type { EmailWebhookPayload, EmailWebhookHeaders } from './email.types';

const CHANNEL = 'email';

/** Minimal shape of Resend's `email.received` webhook event envelope. */
interface ResendReceivedEvent {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
    message_id?: string;
    attachments?: Array<{ id: string; filename: string | null; content_type: string; size?: number }>;
  };
}

/**
 * Resend inbound attachments have no stable public URL — bytes come from the
 * Receiving attachments API, addressed by (email id, attachment id). The
 * pair is encoded into the media `fileRef` so the engine's later
 * `downloadMedia` call can resolve it without extra metadata plumbing:
 * `resend-attachment://<emailId>/<attachmentId>`.
 */
const RESEND_FILE_REF_SCHEME = 'resend-attachment://';

/**
 * Detect Resend's `email.received` event by its envelope shape (no provider
 * header is sent with the webhook).
 */
function isResendReceivedEvent(payload: unknown): boolean {
  return !!payload
    && typeof payload === 'object'
    && (payload as Record<string, unknown>)['type'] === 'email.received'
    && !!(payload as Record<string, unknown>)['data'];
}

export class EmailChannelAdapter implements ChannelAdapter {
  readonly channel = CHANNEL;

  constructor(private emailService: EmailService) {}

  /** Parse a raw webhook payload into normalized inbound messages. */
  async parseInbound(payload: unknown, headers?: Partial<EmailWebhookHeaders>): Promise<OmniInboundMessage[]> {
    // Resend's email.received event carries metadata only; reshape it into
    // the Mailgun-style shape the parser already understands, then fetch the
    // full body/headers from the Receiving API.
    let resendEmailId = '';
    let effectivePayload = payload;
    if (isResendReceivedEvent(payload)) {
      resendEmailId = String((payload as ResendReceivedEvent).data?.email_id || '');
      effectivePayload = await this.buildResendMailgunShape(payload as ResendReceivedEvent);
    }
    const webhook = this.emailService.parseWebhookPayload(effectivePayload);
    if (!webhook) {
      return [];
    }

    const recipient = webhook.recipient;
    if (!recipient) {
      return [];
    }

    const sender = webhook.from || '';
    const senderEmail = sender.includes('<') && sender.includes('>')
      ? sender.match(/<(.+?)>/)?.[1] || sender
      : sender;

    const text = webhook.text || '';
    const html = webhook.html || '';
    const sanitizedHtml = this.emailService.sanitizeHtml(html);
    const content = text || sanitizedHtml;

    if (!content && !webhook.attachments?.length) {
      return [];
    }

    const attachments = (webhook.attachments || []).map((attachment) => ({
      kind: 'file' as const,
      fileName: attachment.name,
      mimeType: attachment.content_type || null,
      fileRef: attachment.resend_id
        ? `${RESEND_FILE_REF_SCHEME}${resendEmailId}/${attachment.resend_id}`
        : attachment.url || attachment.name,
    }));
    const media = attachments[0];

    const metadata: Record<string, unknown> = {
      email: {
        from: webhook.from,
        to: webhook.recipient,
        subject: webhook.subject,
        messageId: webhook.messageId,
        inReplyTo: webhook.inReplyTo,
        references: webhook.references,
        headers: webhook.headers,
        html: sanitizedHtml || undefined,
      },
    };

    // The first attachment becomes the message media; ALL attachments are
    // mirrored in metadata (with Resend ids when present) so nothing the
    // customer sent is lost.
    const mirroredAttachments = (webhook.attachments || []).map((a) => ({
      name: a.name,
      content_type: a.content_type || null,
      size: a.size ?? null,
      ...(a.resend_id ? { resend_id: a.resend_id } : {}),
      url: a.url || null,
    }));
    if (mirroredAttachments.length > 0) {
      (metadata.email as Record<string, unknown>).attachments = mirroredAttachments;
    }

    return [
      {
        externalContactId: this.normalizeEmail(senderEmail),
        username: senderEmail,
        firstName: null,
        lastName: null,
        externalMessageId: webhook.messageId || `${Date.now()}-${Math.random()}`,
        content,
        attachments: attachments.length > 0 ? attachments : undefined,
        media,
        externalTimestamp: webhook.timestamp ? new Date(webhook.timestamp as string | number) : new Date(),
        metadata,
      },
    ];
  }

  /**
   * Reshape a Resend `email.received` event into the Mailgun-style payload
   * the parser already understands. Resend webhooks carry metadata only —
   * body and headers are fetched from the Receiving API using
   * EMAIL_RESEND_API_KEY. The API key is therefore required; without it the
   * transformed payload has no content and the message is dropped (logged).
   */
  private async buildResendMailgunShape(event: ResendReceivedEvent): Promise<Record<string, unknown>> {
    const data = event.data || {};

    let content: ResendEmailContent | null = null;
    if (data.email_id) {
      content = await this.emailService.fetchResendEmailContent(data.email_id);
    }
    if (!content) {
      console.warn(
        `[email] Resend inbound ${data.email_id?.slice(0, 8) ?? '(no id)'}: body unavailable — set EMAIL_RESEND_API_KEY to fetch message content`,
      );
    }

    const headers = content?.headers || {};
    const messageId = content?.message_id || data.message_id || headers['message-id'] || '';
    // Resend attachment metadata (webhook + Receiving API) carries an `id`
    // that addresses the bytes later — preserved as `resend_id` so the
    // adapter can download the file through the SDK when the engine asks.
    const attachments = (content?.attachments || data.attachments || []).map((a) => ({
      name: a.filename || 'attachment',
      content_type: a.content_type || 'application/octet-stream',
      ...(a.size != null ? { size: a.size } : {}),
      ...('id' in a && a.id ? { resend_id: a.id } : {}),
      ...('url' in a && a.url ? { url: a.url } : {}),
    }));

    return {
      recipient: (content?.to && content.to[0]) || (data.to || [])[0] || '',
      sender: content?.from || data.from || '',
      from: content?.from || data.from || '',
      subject: content?.subject ?? data.subject ?? '',
      'body-plain': content?.text || '',
      'body-html': content?.html || '',
      'message-id': messageId,
      'message-headers': JSON.stringify(
        Object.entries(headers).map(([k, v]) => [k, String(v)]),
      ),
      ...(attachments.length > 0 ? { attachments } : {}),
    };
  }

  /**
   * RFC 5322 thread hints for an inbound email: the Message-IDs the customer's
   * mail client says this message replies to (In-Reply-To + References, each
   * normalized). The engine matches them against the external_messages ledger
   * to pin the email to an existing conversation; an empty list means "no
   * threading info" (brand-new thread) and falls back to per-contact grouping.
   */
  async getThreadHints(message: OmniInboundMessage): Promise<OmniThreadHints | null> {
    const emailMeta = ((message.metadata as { email?: { inReplyTo?: string | null; references?: string | string[] | null } } | null) || {})?.email || {};
    // References first (oldest ancestor → direct parent), then In-Reply-To —
    // the ledger lookup pins to the newest matching message either way, but
    // RFC chain order keeps the hint list stable and predictable.
    const raw: string[] = [];
    if (typeof emailMeta.references === 'string') {
      raw.push(...emailMeta.references.split(/\s+/));
    } else if (Array.isArray(emailMeta.references)) {
      raw.push(...emailMeta.references);
    }
    if (emailMeta.inReplyTo) raw.push(emailMeta.inReplyTo);
    const ids = [...new Set(raw.map((id) => normalizeMessageId(id)).filter((id): id is string => !!id))];
    return ids.length > 0 ? { inReplyToMessageIds: ids } : null;
  }

  /** Verify webhook signature (delegated to the email service). */
  verifyWebhookSignature(payload: unknown, headers: EmailWebhookHeaders): boolean {
    if (isResendReceivedEvent(payload)) {
      return this.emailService.verifyResendSignature(payload, headers);
    }
    return this.emailService.verifyWebhookSignature(payload, headers);
  }

  /** Download media bytes for an email attachment, or null when unavailable. */
  async downloadMedia(media: OmniMedia): Promise<Buffer | null> {
    // Resend inbound attachment — fileRef encodes (emailId, attachmentId);
    // bytes are fetched through the Receiving attachments API (SDK).
    if (media.fileRef?.startsWith(RESEND_FILE_REF_SCHEME)) {
      const ref = media.fileRef.slice(RESEND_FILE_REF_SCHEME.length);
      const separator = ref.indexOf('/');
      const emailId = separator > 0 ? ref.slice(0, separator) : '';
      const attachmentId = separator > 0 ? ref.slice(separator + 1) : '';
      if (!emailId || !attachmentId) return null;
      const download = await this.emailService.fetchResendAttachment(emailId, attachmentId);
      return download?.buffer ?? null;
    }
    if (!media.fileRef || !media.fileRef.startsWith('http')) {
      return null;
    }
    try {
      const response = await fetch(media.fileRef);
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer;
    } catch {
      return null;
    }
  }

  /**
   * Send an outbound text message through SMTP.
   *
   * `threading` carries the original subject / Message-ID chain from the
   * engine so the reply threads correctly in the customer's mail client;
   * without it a standalone subject is used.
   */
  async sendMessage(
    chatId: string,
    text: string,
    options: {
      replyToExternalMessageId?: string | null;
      threading?: { subject?: string | null; inReplyTo?: string | null; references?: string[] | null } | null;
    } = {},
  ): Promise<OmniOutboundResult> {
    const from = this.emailService.getFromAddress();
    const result = await this.emailService.sendMail({
      from,
      to: { address: chatId },
      subject: options.threading?.subject || '',
      text,
      html: `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`,
      threading: options.threading || null,
    });

    if (!result.ok) {
      return { ok: false, description: result.description, errorCode: 502 };
    }

    return {
      ok: true,
      externalMessageId: result.messageId || null,
    };
  }

  /** Deliver an outbound file through SMTP as an attachment. */
  async sendMedia(
    chatId: string,
    media: OmniOutboundMedia,
    options: {
      replyToExternalMessageId?: string | null;
      threading?: { subject?: string | null; inReplyTo?: string | null; references?: string[] | null } | null;
    } = {},
  ): Promise<OmniOutboundResult> {
    const from = this.emailService.getFromAddress();
    const text = media.caption?.trim() || '';
    const result = await this.emailService.sendMail({
      from,
      to: { address: chatId },
      subject: text || media.fileName,
      text,
      html: text ? `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : undefined,
      replyTo: options.replyToExternalMessageId || null,
      threading: options.threading || null,
      attachments: [
        {
          filename: media.fileName,
          content: media.buffer,
          contentType: media.mimeType || 'application/octet-stream',
        },
      ],
    });

    if (!result.ok) {
      return { ok: false, description: result.description, errorCode: 502 };
    }

    return {
      ok: true,
      externalMessageId: result.messageId || null,
    };
  }

  /** Health: configured + SMTP reachable? */
  async getHealth(): Promise<OmniHealthResult> {
    const health = await this.emailService.getHealth();
    return {
      connected: health.configured && health.smtpConnected !== false,
      info: health as unknown as Record<string, unknown>,
    };
  }

  /** Webhook administration is provider-specific; delegate to email service stubs. */
  async setupWebhook(webhookUrl: string): Promise<unknown> {
    console.warn(`[${CHANNEL}] Webhook setup must be configured at your email provider (e.g. SendGrid, Mailgun). Target URL: ${webhookUrl}`);
    return { ok: true, description: `Configure webhook at your email provider to point to ${webhookUrl}` };
  }

  async getWebhookInfo(): Promise<unknown> {
    return { channel: CHANNEL, configured: this.emailService.isConfigured() };
  }

  async deleteWebhook(): Promise<unknown> {
    console.warn(`[${CHANNEL}] Webhook deletion must be done at your email provider dashboard.`);
    return { ok: true };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}

export default EmailChannelAdapter;
