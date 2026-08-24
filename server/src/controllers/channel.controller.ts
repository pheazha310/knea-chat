/**
 * ChannelController — MVC controller layer.
 *
 * Handles HTTP requests for channel management and delegates business logic
 * to ChannelService. The route file only maps URLs to these handlers.
 */
import type { NextFunction, Request, Response } from 'express';
import type { ChannelService } from '../services/Channel.service';
import { emitWorkspaceChanged } from '../websocket/workspace.events';

export class ChannelController {
  constructor(private channelService: ChannelService) {}

  /** GET /api/channels */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page = 1, limit = 20, team_id = '' } = req.query;

      const result = await this.channelService.getChannels({
        companyId: req.user!.companyId,
        teamId: team_id ? Number(team_id) : undefined,
        page: Number(page),
        limit: Number(limit),
      });

      res.status(200).json({
        success: true,
        message: 'Channels retrieved successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/channels */
  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, description, type = 'public', team_id, member_ids } = req.body;

      if (!name) {
        res.status(400).json({
          success: false,
          message: 'Channel name is required',
          errors: { name: 'Name is required' },
        });
        return;
      }

      const channel = await this.channelService.createChannel({
        company_id: req.user!.companyId,
        name,
        description,
        created_by: req.user!.id,
        type,
        team_id,
        member_ids: Array.isArray(member_ids) ? member_ids : undefined,
      }, req.user || null);

      emitWorkspaceChanged(req.user!.companyId, 'channels');

      res.status(201).json({
        success: true,
        message: 'Channel created successfully',
        data: { channel },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/channels/:id */
  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const channelId = Number(req.params.id);
      const channel = await this.channelService.getChannel(channelId);
      res.status(200).json({
        success: true,
        message: 'Channel retrieved successfully',
        data: { channel },
      });
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/channels/:id */
  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const channelId = Number(req.params.id);
      const { name, description, type } = req.body;

      const channel = await this.channelService.updateChannel(channelId, { name, description, type }, req.user || null);
      emitWorkspaceChanged(req.user!.companyId, 'channels');
      res.status(200).json({
        success: true,
        message: 'Channel updated successfully',
        data: { channel },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/channels/:id */
  remove = async (req: Request, res: Response): Promise<void> => {
    try {
      const channelId = Number(req.params.id);
      const result = await this.channelService.deleteChannel(channelId, req.user || null);
      emitWorkspaceChanged(req.user!.companyId, 'channels');
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** POST /api/channels/:id/members */
  addMember = async (req: Request, res: Response): Promise<void> => {
    try {
      const channelId = Number(req.params.id);
      const { user_id, role = 'member' } = req.body;

      await this.channelService.addMember(channelId, user_id, role, req.user || null);
      emitWorkspaceChanged(req.user!.companyId, 'channels');
      res.status(201).json({
        success: true,
        message: 'Member added to channel successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/channels/:id/members/:memberId */
  removeMember = async (req: Request, res: Response): Promise<void> => {
    try {
      const channelId = Number(req.params.id);
      const memberId = Number(req.params.memberId);
      const result = await this.channelService.removeMember(channelId, memberId, req.user || null);
      emitWorkspaceChanged(req.user!.companyId, 'channels');
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/channels/:id/members */
  getMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const channelId = Number(req.params.id);
      const members = await this.channelService.getChannelMembers(channelId);
      res.status(200).json({
        success: true,
        message: 'Channel members retrieved successfully',
        data: { members },
      });
    } catch (error) {
      next(error);
    }
  };
}
