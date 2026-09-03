/**
 * NotificationPreferenceController — MVC controller layer for per-user
 * notification preferences (which categories the user wants to receive).
 */
import type { Request, Response } from 'express';
import type { NotificationPreferenceService } from '../services/NotificationPreference.service';

export class NotificationPreferenceController {
  constructor(private notificationPreferenceService: NotificationPreferenceService) {}

  /** GET /api/notification-preferences */
  get = async (req: Request, res: Response): Promise<void> => {
    try {
      const preferences = await this.notificationPreferenceService.getPreferences(req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Notification preferences retrieved successfully',
        data: { preferences },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** PUT /api/notification-preferences — body: { category, enabled } */
  set = async (req: Request, res: Response): Promise<void> => {
    try {
      const { category, enabled } = req.body;
      if (typeof category !== 'string' || typeof enabled !== 'boolean') {
        res.status(400).json({
          success: false,
          message: 'category (string) and enabled (boolean) are required',
          errors: { body: 'Invalid payload' },
        });
        return;
      }
      const preference = await this.notificationPreferenceService.setPreference(
        req.user!.id,
        category,
        enabled,
      );
      res.status(200).json({
        success: true,
        message: 'Notification preference updated successfully',
        data: { preference },
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
