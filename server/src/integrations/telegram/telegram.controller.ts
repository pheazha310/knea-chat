/**
 * TelegramController — HTTP handlers for the Telegram integration.
 *
 * The controller stays thin: it validates the request, delegates business
 * logic to TelegramInboxService (webhook orchestration, agent replies) or
 * TelegramService (health, webhook administration), and maps errors.
 *
 * All database and Telegram API logic lives in the services — never here.
 */
import type { Request, Response } from 'express';
import type { TelegramInboxService } from '../../services/TelegramInbox.service';
import type { TelegramService } from './telegram.service';
import { TelegramApiError } from './telegram.service';
import type { TelegramUpdate } from './telegram.types';

/** Header Telegram sends with every webhook delivery (lower-cased by Express). */
const WEBHOOK_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export class TelegramController {
  constructor(
    private inboxService: TelegramInboxService,
    private telegramService: TelegramService,
  ) {}

  /**
   * POST /api/telegram/webhook
   *
   * 1. Validate the X-Telegram-Bot-Api-Secret-Token header (401 on mismatch).
   * 2. Parse the update and delegate processing to the inbox service.
   * 3. Acknowledge quickly; never let an update crash the Express server.
   */
  webhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
      const receivedSecret = String(req.headers[WEBHOOK_SECRET_HEADER] || '');

      if (expectedSecret) {
        if (receivedSecret !== expectedSecret) {
          console.warn('[telegram] Webhook rejected: invalid secret token');
          res.status(401).json({ success: false, message: 'Invalid webhook secret token' });
          return;
        }
      } else {
        // No secret configured — dev convenience. Always set it in production.
        console.warn('[telegram] TELEGRAM_WEBHOOK_SECRET is not set — webhook is unprotected');
      }

      const update = req.body as TelegramUpdate;
      if (!update || typeof update.update_id !== 'number' || typeof update !== 'object') {
        console.warn('[telegram] Malformed webhook update ignored');
        res.sendStatus(200);
        return;
      }

      try {
        await this.inboxService.handleWebhookUpdate(update);
      } catch (error) {
        // Log diagnostics without the token; acknowledge so Telegram does not
        // retry an update that will fail again. Transient failures still get a
        // 500 so Telegram's retry (with the dedupe guard) can re-deliver.
        const err = error as Error;
        console.error(`[telegram] Webhook processing failed: ${err.message}`);
        res.status(500).json({ success: false, message: 'Telegram update could not be processed' });
        return;
      }

      res.sendStatus(200);
    } catch (error) {
      // Absolute backstop — the webhook must never crash the server.
      console.error('[telegram] Webhook handler error:', (error as Error).message);
      res.sendStatus(200);
    }
  };

  /**
   * POST /api/telegram/messages — authenticated agent reply.
   * The chat id is resolved server-side; the client only supplies the
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

      const message = await this.inboxService.sendAgentReply(
        req.user!.id,
        Number(conversationId),
        String(text),
        replyToMessageId ? Number(replyToMessageId) : null,
      );

      res.status(201).json({
        success: true,
        message: 'Message sent to Telegram',
        data: { message },
      });
    } catch (error) {
      if (error instanceof TelegramApiError) {
        res.status(502).json({ success: false, message: error.message, errors: {} });
        return;
      }
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /**
   * POST /api/telegram/conversations/:id/assign — assign an agent to the
   * conversation (defaults to the requesting agent). Membership is enforced
   * in the service.
   */
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
      const result = await this.inboxService.assignAgent(conversationId, req.user!.id, agentId);
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

  /** DELETE /api/telegram/conversations/:id/assign — unassign the agent. */
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
      const result = await this.inboxService.assignAgent(conversationId, req.user!.id, null);
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

  /**
   * GET /api/telegram/health — public health check.
   * Verifies configuration + bot authentication. Never exposes the token.
   */
  health = async (req: Request, res: Response): Promise<void> => {
    try {
      const health = await this.inboxService.getHealth();
      if (health.connected) {
        res.status(200).json({
          success: true,
          channel: 'telegram',
          connected: true,
          bot: health.bot,
        });
        return;
      }
      if (!this.telegramService.isConfigured()) {
        res.status(200).json({
          success: false,
          channel: 'telegram',
          connected: false,
          message: 'TELEGRAM_BOT_TOKEN is not configured',
        });
        return;
      }
      res.status(200).json({
        success: false,
        channel: 'telegram',
        connected: false,
        message: 'Telegram API unreachable or bot token invalid',
      });
    } catch (error) {
      console.error('[telegram] Health check error:', (error as Error).message);
      res.status(200).json({
        success: false,
        channel: 'telegram',
        connected: false,
        message: 'Telegram health check failed',
      });
    }
  };

  /** POST /api/telegram/setup-webhook — admin only. */
  setupWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const { webhookUrl } = req.body;
      if (!webhookUrl || !/^https:\/\/.+/.test(String(webhookUrl))) {
        res.status(400).json({
          success: false,
          message: 'A public HTTPS webhook URL is required',
          errors: { webhookUrl: 'Must be an https:// URL' },
        });
        return;
      }
      const result = await this.inboxService.setupWebhook(String(webhookUrl));
      if (!result || (result as { ok?: boolean }).ok === false) {
        res.status(502).json({
          success: false,
          message: (result as { description?: string })?.description || 'Telegram rejected the webhook',
          errors: {},
        });
        return;
      }
      res.status(200).json({
        success: true,
        message: 'Telegram webhook configured',
        data: result,
      });
    } catch (error) {
      if (error instanceof TelegramApiError) {
        res.status(502).json({ success: false, message: error.message, errors: {} });
        return;
      }
      res.status(500).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/telegram/webhook-info — admin only. */
  getWebhookInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.inboxService.getWebhookInfo();
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error instanceof TelegramApiError) {
        res.status(502).json({ success: false, message: error.message, errors: {} });
        return;
      }
      res.status(500).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };

  /** DELETE /api/telegram/webhook — admin only. */
  deleteWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.inboxService.deleteWebhook();
      if (!result || (result as { ok?: boolean }).ok === false) {
        res.status(502).json({
          success: false,
          message: (result as { description?: string })?.description || 'Telegram rejected the request',
          errors: {},
        });
        return;
      }
      res.status(200).json({ success: true, message: 'Telegram webhook removed', data: result });
    } catch (error) {
      if (error instanceof TelegramApiError) {
        res.status(502).json({ success: false, message: error.message, errors: {} });
        return;
      }
      res.status(500).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };
}