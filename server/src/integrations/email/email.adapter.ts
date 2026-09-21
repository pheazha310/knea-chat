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
import { EmailService } from './email.service';
import type {
  ChannelAdapter,
  OmniHealthResult,
  OmniInboundMessage,
  OmniMedia,
  OmniOutboundMedia,
  OmniOutboundResult,
} from '../omni/omni.types';
import type { EmailWebhookPayload, EmailWebhookHeaders } from './email.types';

const CHANNEL = 'email';

export class EmailChannelAdapter implements ChannelAdapter {
  readonly channel = CHANNEL;

  constructor(private emailService: EmailService) {}

  /** Parse a raw webhook payload into normalized inbound messages. */
  async parseInbound(payload: unknown): Promise<OmniInboundMessage[]> {
    const webhook = this.emailService.parseWebhookPayload(payload);
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

    const media = webhook.attachments?.length
      ? {
          kind: 'file' as const,
          fileName: webhook.attachments[0].name,
          mimeType: webhook.attachments[0].content_type || null,
          fileRef: webhook.attachments[0].url || webhook.attachments[0].name,
        }
      : undefined;

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

    // Only the first attachment becomes the message media; every remaining
    // attachment is recorded in metadata so nothing the customer sent is lost.
    const extraAttachments = (webhook.attachments || []).slice(1).map((a) => ({
      name: a.name,
      content_type: a.content_type || null,
      size: a.size ?? null,
      url: a.url || null,
    }));
    if (extraAttachments.length > 0) {
      (metadata.email as Record<string, unknown>).attachments = [webhook.attachments![0], ...extraAttachments];
    }

    return [
      {
        externalContactId: this.normalizeEmail(senderEmail),
        username: senderEmail,
        firstName: null,
        lastName: null,
        externalMessageId: webhook.messageId || `${Date.now()}-${Math.random()}`,
        content,
        media,
        externalTimestamp: webhook.timestamp ? new Date(webhook.timestamp as string | number) : new Date(),
        metadata,
      },
    ];
  }

  /** Verify webhook signature (delegated to the email service). */
  verifyWebhookSignature(payload: unknown, headers: EmailWebhookHeaders): boolean {
    return this.emailService.verifyWebhookSignature(payload, headers);
  }

  /** Download media bytes for an email attachment, or null when unavailable. */
  async downloadMedia(media: OmniMedia): Promise<Buffer | null> {
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
