/**
 * OmniController — HTTP handlers shared by every channel adapter.
 *
 *   GET    /api/omni/health/:channel        — public health probe
 *   POST   /api/omni/conversations/:id/assign   — claim (any inbox member)
 *   DELETE /api/omni/conversations/:id/assign   — unassign
 *   PATCH  /api/omni/conversations/:id/status   — open/close
 *   POST   /api/omni/conversations/:id/messages — agent reply (any channel)
 *
 * Channel webhooks are NOT routed here generically: each channel owns its
 * provider-specific webhook endpoint + secret check (e.g. Telegram's
 * `/api/telegram/webhook` validates `X-Telegram-Bot-Api-Secret-Token`), so a
 * future channel cannot be reached through a generic unauthenticated route.
 */
import type { Request, Response } from 'express';
import type { OmniChannelService } from '../../services/OmniChannel.service';

export class OmniController {
  constructor(private omniService: OmniChannelService) {}

  /** GET /api/omni/health/:channel — public. */
  health = async (req: Request, res: Response): Promise<void> => {
    const channel = String(req.params.channel || '').toLowerCase();
    try {
      const health = await this.omniService.getHealth(channel);
      res.status(200).json({
        success: health.connected,
        channel,
        connected: health.connected,
        ...(health.info ? { info: health.info } : {}),
      });
    } catch (error) {
      res.status(200).json({
        success: false,
        channel,
        connected: false,
        message: (error as Error).message,
      });
    }
  };

  /** POST /api/omni/conversations/:id/assign — claim (defaults to self). */
  assignConversation = async (req: Request, res: Response): Promise<void> => {
    try {
      const conversationId = Number(req.params.id);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid conversation id', errors: {} });
        return;
      }
      const agentId = req.body?.agentId ? Number(req.body.agentId) : req.user!.id;
      const result = await this.omniService.assignAgent(conversationId, req.user!.id, agentId);
      res.status(200).json({ success: true, message: 'Conversation assigned', data: result });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 400).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };

  /** DELETE /api/omni/conversations/:id/assign — unassign. */
  unassignConversation = async (req: Request, res: Response): Promise<void> => {
    try {
      const conversationId = Number(req.params.id);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid conversation id', errors: {} });
        return;
      }
      const result = await this.omniService.assignAgent(conversationId, req.user!.id, null);
      res.status(200).json({ success: true, message: 'Conversation unassigned', data: result });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 400).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };

  /**
   * POST /api/omni/conversations/:id/messages — agent reply to any channel.
   * The provider chat id is resolved server-side from the stored contact.
   */
  sendMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      const conversationId = Number(req.params.id);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid conversation id', errors: {} });
        return;
      }
      const text = String(req.body?.text || '');
      if (!text.trim()) {
        res.status(400).json({ success: false, message: 'text is required', errors: {} });
        return;
      }
      const replyToMessageId = req.body?.replyToMessageId
        ? Number(req.body.replyToMessageId)
        : null;
      const message = await this.omniService.sendAgentReply(
        conversationId,
        req.user!.id,
        text,
        replyToMessageId,
      );
      res.status(201).json({ success: true, data: { message } });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 400).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };

  /** PATCH /api/omni/conversations/:id/status — open / close. */
  setStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const conversationId = Number(req.params.id);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid conversation id', errors: {} });
        return;
      }
      const status = String(req.body?.status || '');
      if (status !== 'open' && status !== 'closed') {
        res.status(400).json({ success: false, message: 'status must be "open" or "closed"', errors: {} });
        return;
      }
      const result = await this.omniService.setConversationStatus(conversationId, req.user!.id, status);
      res.status(200).json({ success: true, message: `Conversation ${status}`, data: result });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 400).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };
}