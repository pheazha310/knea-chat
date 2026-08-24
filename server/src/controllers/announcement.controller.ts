/**
 * AnnouncementController — MVC controller layer.
 *
 * Handles HTTP requests for company-wide announcements and delegates
 * business logic to AnnouncementService. Publishing/editing/deleting is
 * manager+ (enforced on the routes); listing is open to every authenticated
 * user of the company. Live clients are updated via WebSocket events.
 */
import type { NextFunction, Request, Response } from 'express';
import type { AnnouncementService } from '../services/Announcement.service';
import { emitAnnouncementEvent } from '../websocket/workspace.events';

const snippetOf = (content: string): string =>
  content.length > 120 ? `${content.slice(0, 120)}…` : content;

export class AnnouncementController {
  constructor(private announcementService: AnnouncementService) {}

  /** GET /api/announcements */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const announcements = await this.announcementService.getAnnouncements(
        req.user!.companyId,
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
      const { title, content } = req.body;

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
      });

      // Live update of the dedicated announcements list — the publisher
      // already applied the create response, so exclude them.
      emitAnnouncementEvent(req.user!.companyId, {
        type: 'announcement_created',
        data: { announcement },
      }, req.user!.id);
      // Bell + toast update — reuse the established `notification` event so
      // the existing wsListeners / Dashboard toast handlers light up.
      emitAnnouncementEvent(req.user!.companyId, {
        type: 'notification',
        data: {
          type: 'announcement',
          title: `Announcement: ${announcement.title}`,
          message: snippetOf(String(content)),
          announcementId: announcement.id,
        },
      }, req.user!.id);

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
      const { title, content } = req.body;

      const announcement = await this.announcementService.updateAnnouncement(announcementId, {
        title,
        content,
      });

      emitAnnouncementEvent(req.user!.companyId, {
        type: 'announcement_updated',
        data: { announcement },
      }, req.user!.id);

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
      const result = await this.announcementService.deleteAnnouncement(announcementId);

      emitAnnouncementEvent(req.user!.companyId, {
        type: 'announcement_deleted',
        data: { id: announcementId },
      }, req.user!.id);

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
}
