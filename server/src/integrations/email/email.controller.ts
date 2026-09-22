/**
 * EmailController — HTTP handlers for the email omni-channel.
 *
 *   POST /api/email/webhook         — public (email provider calls it)
 *   GET  /api/email/health          — public
 *   POST /api/email/messages        — any authenticated agent
 *   POST /api/email/conversations/:id/assign    — any inbox member
 *   DELETE /api/email/conversations/:id/assign  — any inbox member
 *   POST /api/email/setup-webhook    — admin+
 *   GET  /api/email/webhook-info     — admin+
 *   DELETE /api/email/webhook         — admin+
 */
import type { Request, Response } from 'express';
import type { OmniChannelService } from '../../services/OmniChannel.service';
import type { EmailChannelAdapter } from './email.adapter';
import type { EmailWebhookHeaders, RawBodyRequest } from './email.types';

const CHANNEL = 'email';

const WEBHOOK_SECRET_HEADER = 'x-email-webhook-secret';
const WEBHOOK_PROVIDER_HEADER = 'x-email-provider';

/**
 * In-flight inbound deliveries keyed by Message-ID: a provider retry racing
 * the original request must not double-persist (the DB unique key catches the
 * settled case; this catches the concurrent one).
 */
const inFlight = new Set<string>();

export class EmailController {
  constructor(private omniService: OmniChannelService, private adapter: EmailChannelAdapter) {}

  /**
   * POST /api/email/webhook
   *
   * 1. Validate webhook signature (401 on mismatch).
   * 2. Parse the inbound payload through the adapter.
   * 3. Delegate to the omni-channel engine.
   * 4. Acknowledge quickly — never let a webhook crash the server.
   */
  webhook = async (req: RawBodyRequest, res: Response): Promise<void> => {
    try {
      const expectedSecret = process.env.EMAIL_WEBHOOK_SECRET || '';
      const receivedSecret = String(req.headers[WEBHOOK_SECRET_HEADER] || '');
      let provider = String(req.headers[WEBHOOK_PROVIDER_HEADER] || '').toLowerCase();

      // Real Mailgun routes post signature/timestamp/token as body fields (the
      // route forwards them form- or JSON-encoded) and send no identifying
      // header — detect Mailgun from that payload shape.
      const hookBody = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      if (!provider && hookBody['signature'] && hookBody['token'] && hookBody['timestamp'] !== undefined) {
        provider = 'mailgun';
      }

      if (expectedSecret) {
        const headers: EmailWebhookHeaders = {
          provider,
          signature: String(req.headers['x-email-signature'] || ''),
          'x-twilio-email-event-webhook-signature': String(req.headers['x-twilio-email-event-webhook-signature'] || ''),
          'x-twilio-email-event-webhook-timestamp': String(req.headers['x-twilio-email-event-webhook-timestamp'] || ''),
          'x-mailgun-signature':
            String(req.headers['x-mailgun-signature'] || '') || String(hookBody['signature'] || ''),
          'x-mailgun-timestamp':
            String(req.headers['x-mailgun-timestamp'] || '') || String(hookBody['timestamp'] ?? ''),
          'x-mailgun-token':
            String(req.headers['x-mailgun-token'] || '') || String(hookBody['token'] || ''),
          'x-postmark-webhook-signature': String(req.headers['x-postmark-webhook-signature'] || ''),
          'svix-id': String(req.headers['svix-id'] || ''),
          'svix-timestamp': String(req.headers['svix-timestamp'] || ''),
          'svix-signature': String(req.headers['svix-signature'] || ''),
          'svix-raw-body': String(req.rawBody ?? ''),
        };

        const isValid = await this.adapter.verifyWebhookSignature(req.body, headers);
        if (!isValid) {
          console.warn('[email] Webhook rejected: invalid signature');
          res.status(401).json({ success: false, message: 'Invalid webhook signature' });
          return;
        }
      } else {
        console.warn('[email] EMAIL_WEBHOOK_SECRET is not set — webhook is unprotected');
      }

      const messages = await this.adapter.parseInbound(req.body);
      if (messages.length === 0) {
        res.sendStatus(200);
        return;
      }

      // Concurrent-delivery guard: skip duplicates whose DB row does not
      // exist yet (the unique (channel, external_message_id) key handles the
      // settled case in the engine).
      const messageIds = messages
        .map((m) => `${CHANNEL}:${m.externalMessageId}`)
        .filter(Boolean);
      const duplicates = messageIds.filter((id) => inFlight.has(id));
      if (duplicates.length > 0) {
        console.warn(`[email] Concurrent duplicate webhook delivery ignored: ${duplicates.join(', ')}`);
        res.sendStatus(200);
        return;
      }
      for (const id of messageIds) inFlight.add(id);
      try {
        await this.omniService.processInbound(CHANNEL, req.body);
      } finally {
        for (const id of messageIds) inFlight.delete(id);
      }

      res.sendStatus(200);
    } catch (error) {
      console.error('[email] Webhook handler error:', (error as Error).message);
      res.sendStatus(200);
    }
  };

  /**
   * POST /api/email/messages — authenticated agent reply.
   * The email address is resolved server-side; the client only supplies the
   * KneaChat conversation id.
   */
  sendMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId, text, replyToMessageId } = req.body;
      if (!conversationId || !text) {
        res.status(400).json({
          success: false,
          message: 'conversationId and text are required',
          errors: { validation: 'Missing required fields' },
        });
        return;
      }

      const message = await this.omniService.sendAgentReply(
        Number(conversationId),
        req.user!.id,
        String(text),
        replyToMessageId ? Number(replyToMessageId) : null,
      );

      res.status(201).json({
        success: true,
        message: 'Email sent',
        data: { message },
      });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** POST /api/email/conversations/:id/assign — assign an agent. */
  assignAgent = async (req: Request, res: Response): Promise<void> => {
    try {
      const conversationId = Number(req.params.id);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        res.status(400).json({
          success: false,
          message: 'Invalid conversation id',
          errors: { validation: 'A positive conversation id is required' },
        });
        return;
      }
      const agentId = req.body?.agentId ? Number(req.body.agentId) : req.user!.id;
      const result = await this.omniService.assignAgent(conversationId, req.user!.id, agentId);
      res.status(200).json({
        success: true,
        message: 'Conversation assigned',
        data: result,
      });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/email/conversations/:id/assign — unassign. */
  unassignAgent = async (req: Request, res: Response): Promise<void> => {
    try {
      const conversationId = Number(req.params.id);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        res.status(400).json({
          success: false,
          message: 'Invalid conversation id',
          errors: { validation: 'A positive conversation id is required' },
        });
        return;
      }
      const result = await this.omniService.assignAgent(conversationId, req.user!.id, null);
      res.status(200).json({
        success: true,
        message: 'Conversation unassigned',
        data: result,
      });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/email/health — public. */
  health = async (req: Request, res: Response): Promise<void> => {
    try {
      const health = await this.omniService.getHealth(CHANNEL);
      res.status(200).json({
        success: health.connected,
        channel: CHANNEL,
        connected: health.connected,
        ...(health.info ? { info: health.info } : {}),
      });
    } catch (error) {
      res.status(200).json({
        success: false,
        channel: CHANNEL,
        connected: false,
        message: (error as Error).message,
      });
    }
  };

  /** POST /api/email/setup-webhook — admin only. */
  setupWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const webhookUrl =
        String(req.body?.webhookUrl || '').trim() || process.env.EMAIL_WEBHOOK_URL || '';
      if (!webhookUrl || !/^https?:\/\/.+/.test(webhookUrl)) {
        res.status(400).json({
          success: false,
          message: 'A public HTTPS webhook URL is required',
          errors: {
            webhookUrl: 'Set EMAIL_WEBHOOK_URL in the environment or pass {"webhookUrl": "https://..."}',
          },
        });
        return;
      }
      const result = await this.omniService.setupWebhook(CHANNEL, String(webhookUrl));
      if (!result || (result as { ok?: boolean }).ok === false) {
        res.status(502).json({
          success: false,
          message: (result as { description?: string })?.description || 'Email provider rejected the webhook',
          errors: {},
        });
        return;
      }
      res.status(200).json({
        success: true,
        message: 'Email webhook configured',
        data: result,
      });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 500).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/email/webhook-info — admin only. */
  getWebhookInfo = async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.omniService.getWebhookInfo(CHANNEL);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 500).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };

  /** DELETE /api/email/webhook — admin only. */
  deleteWebhook = async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.omniService.deleteWebhook(CHANNEL);
      if (!result || (result as { ok?: boolean }).ok === false) {
        res.status(502).json({
          success: false,
          message: (result as { description?: string })?.description || 'Email provider rejected the request',
          errors: {},
        });
        return;
      }
      res.status(200).json({ success: true, message: 'Email webhook removed', data: result });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 500).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };
}
