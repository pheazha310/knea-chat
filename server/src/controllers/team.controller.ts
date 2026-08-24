/**
 * TeamController — MVC controller layer.
 *
 * Handles HTTP requests for team management and delegates business logic to
 * TeamService. The route file only maps URLs to these handlers.
 */
import type { NextFunction, Request, Response } from 'express';
import type { TeamService } from '../services/Team.service';
import { emitWorkspaceChanged } from '../websocket/workspace.events';

export class TeamController {
  constructor(private teamService: TeamService) {}

  /** GET /api/teams */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page = 1, limit = 20, search = '' } = req.query;

      const result = await this.teamService.getTeams({
        companyId: req.user!.companyId,
        page: Number(page),
        limit: Number(limit),
        search: String(search),
        requesterId: req.user!.id,
      });

      res.status(200).json({
        success: true,
        message: 'Teams retrieved successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/teams */
  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, description, department_id, member_ids } = req.body;

      if (!name) {
        res.status(400).json({
          success: false,
          message: 'Team name is required',
          errors: { name: 'Name is required' },
        });
        return;
      }

      const team = await this.teamService.createTeam({
        company_id: req.user!.companyId,
        name,
        description,
        created_by: req.user!.id,
        department_id,
        member_ids: Array.isArray(member_ids) ? member_ids : undefined,
      });

      emitWorkspaceChanged(req.user!.companyId, 'teams');

      res.status(201).json({
        success: true,
        message: 'Team created successfully',
        data: { team },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/teams/:id */
  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const teamId = Number(req.params.id);
      const team = await this.teamService.getTeam(teamId);
      res.status(200).json({
        success: true,
        message: 'Team retrieved successfully',
        data: { team },
      });
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/teams/:id */
  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const teamId = Number(req.params.id);
      const { name, description } = req.body;

      const team = await this.teamService.updateTeam(teamId, { name, description }, req.user || null);
      emitWorkspaceChanged(req.user!.companyId, 'teams');
      res.status(200).json({
        success: true,
        message: 'Team updated successfully',
        data: { team },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/teams/:id */
  remove = async (req: Request, res: Response): Promise<void> => {
    try {
      const teamId = Number(req.params.id);
      const result = await this.teamService.deleteTeam(teamId, req.user || null);
      emitWorkspaceChanged(req.user!.companyId, 'teams');
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

  /** POST /api/teams/:id/members */
  addMember = async (req: Request, res: Response): Promise<void> => {
    try {
      const teamId = Number(req.params.id);
      const { user_id, role = 'member' } = req.body;

      await this.teamService.addMember(teamId, user_id, role, req.user || null);
      emitWorkspaceChanged(req.user!.companyId, 'teams');
      res.status(201).json({
        success: true,
        message: 'Member added to team successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/teams/:id/members/:memberId */
  removeMember = async (req: Request, res: Response): Promise<void> => {
    try {
      const teamId = Number(req.params.id);
      const memberId = Number(req.params.memberId);
      const result = await this.teamService.removeMember(teamId, memberId, req.user || null);
      emitWorkspaceChanged(req.user!.companyId, 'teams');
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

  /** GET /api/teams/:id/members */
  getMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const teamId = Number(req.params.id);
      const members = await this.teamService.getTeamMembers(teamId);
      res.status(200).json({
        success: true,
        message: 'Team members retrieved successfully',
        data: { members },
      });
    } catch (error) {
      next(error);
    }
  };
}
