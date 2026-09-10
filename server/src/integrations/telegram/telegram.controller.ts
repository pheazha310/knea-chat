/**
 * TelegramController — HTTP handlers for the Telegram channel.
 *
 * Keeps Telegram's documented route surface (/api/telegram/*) while delegating
 * ALL business logic to the channel-agnostic OmniChannelService — the same
 * engine any future channel uses.
 *
 * The controller stays thin: request validation, the Telegram webhook secret
 * check, and error mapping only.
 */
import type { Request, Response } from 'express';
import type { OmniChannelService } from '../../services/OmniChannel.service';
import type { TelegramUpdate } from './telegram.types';

/** Header Telegram sends with every webhook delivery (lower-cased by Express). */
const WEBHOOK_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

const CHANNEL = 'telegram';

export class TelegramController {
  constructor(private omniService: OmniChannelService) {}

  /**
   * POST /api/telegram/webhook
   *
   * 1. Validate the X-Telegram-Bot-Api-Secret-Token header (401 on mismatch).
   * 2. Delegate update processing to the omni-channel engine.
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
        await this.omniService.processInbound(CHANNEL, update);
      } catch (error) {
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

      const message = await this.omniService.sendAgentReply(
        Number(conversationId),
        req.user!.id,
        String(text),
        replyToMessageId ? Number(replyToMessageId) : null,
      );

      res.status(201).json({
        success: true,
        message: 'Message sent to Telegram',
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

  /**
   * GET /api/telegram/health — public health check.
   * Verifies configuration + bot authentication. Never exposes the token.
   */
  health = async (req: Request, res: Response): Promise<void> => {
    try {
      const health = await this.omniService.getHealth(CHANNEL);
      if (health.connected) {
        res.status(200).json({
          success: true,
          channel: CHANNEL,
          connected: true,
          bot: (health.info?.bot as { id?: number; username?: string }) || undefined,
        });
        return;
      }
      res.status(200).json({
        success: false,
        channel: CHANNEL,
        connected: false,
        message: 'Telegram bot is not configured or unreachable',
      });
    } catch (error) {
      console.error('[telegram] Health check error:', (error as Error).message);
      res.status(200).json({
        success: false,
        channel: CHANNEL,
        connected: false,
        message: 'Telegram health check failed',
      });
    }
  };

  /** POST /api/telegram/setup-webhook — admin only. */
  setupWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      // Default to TELEGRAM_WEBHOOK_URL when the client does not post one.
      const webhookUrl =
        String(req.body?.webhookUrl || '').trim() ||
        process.env.TELEGRAM_WEBHOOK_URL ||
        '';
      if (!webhookUrl || !/^https:\/\/.+/.test(webhookUrl)) {
        res.status(400).json({
          success: false,
          message: 'A public HTTPS webhook URL is required',
          errors: {
            webhookUrl:
              'Set TELEGRAM_WEBHOOK_URL in the environment or pass {"webhookUrl": "https://..."}',
          },
        });
        return;
      }
      const result = await this.omniService.setupWebhook(CHANNEL, String(webhookUrl));
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
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 500).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/telegram/webhook-info — admin only. */
  getWebhookInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.omniService.getWebhookInfo(CHANNEL);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 500).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };

  /** DELETE /api/telegram/webhook — admin only. */
  deleteWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.omniService.deleteWebhook(CHANNEL);
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
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 500).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };
}