/**
 * NotificationController — MVC controller layer.
 *
 * Handles HTTP requests for the notification center and delegates business
 * logic to NotificationService (which owns NotificationRepository).
 */
import type { NextFunction, Request, Response } from 'express';
import type { NotificationService } from '../services/Notification.service';

export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  /** GET /api/notifications */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page = 1, limit = 20, is_read = '' } = req.query;

      const { notifications, unreadCount } = await this.notificationService.getNotifications(req.user!.id, {
        page: parseInt(String(page)),
        limit: parseInt(String(limit)),
        is_read: String(is_read),
      });

      res.status(200).json({
        success: true,
        message: 'Notifications retrieved successfully',
        data: {
          notifications,
          unreadCount,
          pagination: { page: parseInt(String(page)), limit: parseInt(String(limit)), total: notifications.length },
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/notifications/:id/read */
  markAsRead = async (req: Request, res: Response): Promise<void> => {
    try {
      const notificationId = Number(req.params.id);
      await this.notificationService.markAsRead(notificationId);
      res.status(200).json({
        success: true,
        message: 'Notification marked as read',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** POST /api/notifications/read-all */
  markAllAsRead = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.notificationService.markAllAsRead(req.user!.id);
      res.status(200).json({
        success: true,
        message: 'All notifications marked as read',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/notifications/:id */
  remove = async (req: Request, res: Response): Promise<void> => {
    try {
      const notificationId = Number(req.params.id);
      await this.notificationService.remove(notificationId);
      res.status(200).json({
        success: true,
        message: 'Notification deleted successfully',
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
