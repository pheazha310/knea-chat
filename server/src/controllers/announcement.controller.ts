/**
 * AnnouncementController — MVC controller layer.
 *
 * Handles HTTP requests for announcements (company / department / team scope,
 * pinned, scheduled) and delegates business logic to AnnouncementService.
 * Publishing/editing/deleting is manager+ (enforced on the routes); listing,
 * reading, and marking-read are open to every authenticated user of the
 * company (the service scopes what they may see). Live clients are updated
 * via WebSocket events sent only to the announcement's audience.
 */
import type { NextFunction, Request, Response } from 'express';
import type { AuditLogService } from '../services/AuditLog.service';
import type { AnnouncementService } from '../services/Announcement.service';
import { emitAnnouncementEvent, emitAnnouncementToUsers } from '../websocket/workspace.events';

const snippetOf = (content: string): string =>
  content.length > 120 ? `${content.slice(0, 120)}…` : content;

export class AnnouncementController {
  constructor(
    private announcementService: AnnouncementService,
    private auditLogService?: AuditLogService | null,
  ) {}

  /** Best-effort audit record for administrative announcement actions. */
  private async record(
    req: Request,
    action: string,
    announcementId: number,
    details?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditLogService) return;
    await this.auditLogService.log({
      company_id: req.user!.companyId,
      actor_user_id: req.user!.id,
      actor_role: req.user!.role,
      action,
      entity_type: 'announcement',
      entity_id: announcementId,
      details,
      ip_address: req.ip,
    });
  }

  /** GET /api/announcements */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const announcements = await this.announcementService.getAnnouncements(
        req.user!.companyId,
        req.user!.id,
      );
      res.status(200).json({
        success: true,
        message: 'Announcements retrieved successfully',
        data: { announcements },
      });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/announcements/:id */
  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const announcement = await this.announcementService.getAnnouncement(
        Number(req.params.id),
        req.user!.companyId,
        req.user!.id,
      );
      res.status(200).json({
        success: true,
        message: 'Announcement retrieved successfully',
        data: { announcement },
      });
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/announcements */
  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, content, scope, department_id, team_id, is_pinned, scheduled_at } = req.body;

      if (!title || !content) {
        res.status(400).json({
          success: false,
          message: 'Title and content are required',
          errors: { validation: 'Required fields: title, content' },
        });
        return;
      }

      const announcement = await this.announcementService.createAnnouncement({
        company_id: req.user!.companyId,
        title,
        content,
        created_by: req.user!.id,
        scope,
        department_id,
        team_id,
        is_pinned,
        scheduled_at,
      });

      // Live update of the dedicated announcements list — the publisher
      // already applied the create response, so exclude them. Only published
      // announcements broadcast now; scheduled ones broadcast when the
      // scheduler flips them live.
      if (announcement.is_published) {
        const recipientIds = await this.announcementService.getRecipientIds(announcement.id);
        emitAnnouncementToUsers(recipientIds, {
          type: 'announcement_created',
          data: { announcement },
        }, req.user!.id);
        // Bell + toast update — reuse the established `notification` event so
        // the existing wsListeners / Dashboard toast handlers light up.
        emitAnnouncementToUsers(recipientIds, {
          type: 'notification',
          data: {
            type: 'announcement',
            title: `Announcement: ${announcement.title}`,
            message: snippetOf(String(content)),
            announcementId: announcement.id,
          },
        }, req.user!.id);
      }

      await this.record(req, 'announcement.created', announcement.id, {
        title: announcement.title,
        scope: announcement.scope,
      });

      res.status(201).json({
        success: true,
        message: 'Announcement published successfully',
        data: { announcement },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** PATCH /api/announcements/:id */
  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const announcementId = Number(req.params.id);
      const { title, content, scope, department_id, team_id, is_pinned, scheduled_at } = req.body;

      const announcement = await this.announcementService.updateAnnouncement(
        announcementId,
        { title, content, scope, department_id, team_id, is_pinned, scheduled_at },
        req.user!.id,
        req.user!.companyId,
      );

      if (announcement.is_published) {
        const recipientIds = await this.announcementService.getRecipientIds(announcement.id);
        emitAnnouncementToUsers(recipientIds, {
          type: 'announcement_updated',
          data: { announcement },
        }, req.user!.id);
      }

      await this.record(req, 'announcement.updated', announcement.id, {
        title: announcement.title,
        scope: announcement.scope,
      });

      res.status(200).json({
        success: true,
        message: 'Announcement updated successfully',
        data: { announcement },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/announcements/:id */
  remove = async (req: Request, res: Response): Promise<void> => {
    try {
      const announcementId = Number(req.params.id);
      const recipientIds = await this.announcementService.getRecipientIds(announcementId);
      const result = await this.announcementService.deleteAnnouncement(announcementId, req.user!.companyId);

      emitAnnouncementToUsers(recipientIds, {
        type: 'announcement_deleted',
        data: { id: announcementId },
      }, req.user!.id);

      await this.record(req, 'announcement.deleted', announcementId);

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

  /** POST /api/announcements/:id/read — mark an announcement as read. */
  markRead = async (req: Request, res: Response): Promise<void> => {
    try {
      const announcement = await this.announcementService.markRead(
        Number(req.params.id),
        req.user!.id,
        req.user!.companyId,
      );
      res.status(200).json({
        success: true,
        message: 'Announcement marked as read',
        data: { announcement },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** POST /api/announcements/:id/reactions — add an emoji reaction. */
  addReaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const reaction = String(req.body.reaction || '').trim();
      if (!reaction) {
        res.status(400).json({
          success: false,
          message: 'Reaction is required',
          errors: { reaction: 'Reaction emoji/text is required' },
        });
        return;
      }
      const reactions = await this.announcementService.addReaction(
        Number(req.params.id),
        req.user!.companyId,
        req.user!.id,
        reaction,
      );
      res.status(201).json({
        success: true,
        message: 'Reaction added successfully',
        data: { reactions },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/announcements/:id/reactions/:reactionType — remove a reaction. */
  removeReaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const reactions = await this.announcementService.removeReaction(
        Number(req.params.id),
        req.user!.companyId,
        req.user!.id,
        String(req.params.reactionType),
      );
      res.status(200).json({
        success: true,
        message: 'Reaction removed successfully',
        data: { reactions },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/announcements/:id/reads — read confirmation (manager+). */
  readers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { readers, total_recipients } = await this.announcementService.getReaders(
        Number(req.params.id),
        req.user!.companyId,
      );
      res.status(200).json({
        success: true,
        message: 'Readers retrieved successfully',
        data: { readers, total_recipients },
      });
    } catch (error) {
      next(error);
    }
  };
}