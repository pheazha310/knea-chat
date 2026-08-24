/**
 * ConversationController — MVC controller layer.
 *
 * Handles HTTP requests for conversations (direct, group, channel) and
 * delegates business logic to ConversationService / MessageService.
 */
import type { NextFunction, Request, Response } from 'express';
import type { ConversationService } from '../services/Conversation.service';
import type { ConversationRepository } from '../repositories/conversationRepository';
import type { MessageService } from '../services/Message.service';

export class ConversationController {
  constructor(
    private conversationService: ConversationService,
    private conversationRepository: ConversationRepository,
    private messageService: MessageService,
  ) {}

  /** GET /api/conversations */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page = 1, limit = 20, type = '' } = req.query;

      const result = await this.conversationService.getConversations({
        userId: req.user!.id,
        page: Number(page),
        limit: Number(limit),
        type: String(type),
      });

      res.status(200).json({
        success: true,
        message: 'Conversations retrieved successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/conversations */
  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const { type, participant_ids = [], name, description } = req.body;

      if (!type || !['direct', 'group', 'channel', 'team'].includes(type)) {
        res.status(400).json({
          success: false,
          message: 'Invalid conversation type',
          errors: { type: 'Type must be direct, group, channel, or team' },
        });
        return;
      }

      const conversation = await this.conversationService.createConversation({
        type,
        created_by: req.user!.id,
        name,
        description,
        participant_ids,
        company_id: req.user!.companyId,
      });

      res.status(201).json({
        success: true,
        message: 'Conversation created successfully',
        data: { conversation },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/conversations/:id */
  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conversationId = Number(req.params.id);
      const conversation = await this.conversationService.getConversation(
        conversationId,
        req.user!.id,
      );
      (conversation as { members?: unknown[] }).members = await this.conversationRepository.findMembers(conversationId);

      res.status(200).json({
        success: true,
        message: 'Conversation retrieved successfully',
        data: { conversation },
      });
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/conversations/:id/members */
  addMember = async (req: Request, res: Response): Promise<void> => {
    try {
      const conversationId = Number(req.params.id);
      const { user_id } = req.body;

      if (!user_id) {
        res.status(400).json({
          success: false,
          message: 'User ID is required',
          errors: { user_id: 'User ID is required' },
        });
        return;
      }

      await this.conversationService.addMember(conversationId, user_id, req.user!.id);
      res.status(201).json({
        success: true,
        message: 'Member added to conversation successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/conversations/:id/messages */
  getMessages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conversationId = Number(req.params.id);
      const { page = 1, limit = 30 } = req.query;

      const messages = await this.messageService.getMessages(conversationId, Number(page), Number(limit), req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Messages retrieved successfully',
        data: {
          messages,
          pagination: { page: parseInt(String(page)), limit: parseInt(String(limit)), total: messages.length },
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/conversations/direct */
  createDirect = async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId } = req.body;

      if (!userId) {
        res.status(400).json({
          success: false,
          message: 'User ID is required',
          errors: { userId: 'User ID is required' },
        });
        return;
      }

      const conversation = await this.conversationService.findOrCreateDirectConversation(req.user!.id, userId);
      res.status(200).json({
        success: true,
        message: 'Direct conversation retrieved successfully',
        data: { conversation },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };
}
