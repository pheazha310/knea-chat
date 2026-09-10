/**
 * WebsiteController — HTTP handlers for the website channel.
 *
 * Keeps the website route surface (/api/website/*) while delegating ALL
 * business logic to the channel-agnostic OmniChannelService.
 */
import type { Request, Response } from 'express';
import type { OmniChannelService } from '../../services/OmniChannel.service';

const CHANNEL = 'website';

export class WebsiteController {
  constructor(private omniService: OmniChannelService) {}

  /**
   * POST /api/website/webhook
   *
   * Accepts website widget webhook deliveries and delegates update processing
   * to the omni-channel engine.
   */
  webhook = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.omniService.processInbound(CHANNEL, req.body);
      res.sendStatus(200);
    } catch (error) {
      console.error(`[${CHANNEL}] Webhook processing failed:`, (error as Error).message);
      res.status(500).json({ success: false, message: 'Website update could not be processed' });
    }
  };

  /**
   * POST /api/website/messages — authenticated agent reply.
   * The visitor id is resolved server-side; the client only supplies the
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
        message: 'Message sent to website visitor',
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
   * POST /api/website/conversations/:id/assign — assign an agent to the
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

  /** DELETE /api/website/conversations/:id/assign — unassign the agent. */
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
   * GET /api/website/health — public health check.
   */
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
}
