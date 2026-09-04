/**
 * SystemSettingController — MVC controller layer.
 *
 * Handles HTTP requests for platform settings. The public subset requires no
 * authentication; everything else is reserved for the platform Super Admin
 * (enforced by middleware in the route file).
 */
import type { NextFunction, Request, Response } from 'express';
import type { AuditLogService } from '../services/AuditLog.service';
import type { SystemSettingService } from '../services/SystemSetting.service';

export class SystemSettingController {
  constructor(
    private systemSettingService: SystemSettingService,
    private auditLogService?: AuditLogService | null,
  ) {}

  /** Best-effort platform-scope audit record (settings changes). */
  private async record(req: Request, details: Record<string, unknown>): Promise<void> {
    if (!this.auditLogService) return;
    await this.auditLogService.log({
      company_id: null,
      actor_user_id: req.user!.id,
      actor_role: req.user!.role,
      action: 'settings.updated',
      entity_type: 'system_settings',
      entity_id: null,
      details,
      ip_address: req.ip,
    });
  }

  /**
   * GET /api/settings/public
   * Public subset of platform settings — no authentication so the login page
   * can render registration / maintenance state before the user signs in.
   */
  getPublic = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const settings = await this.systemSettingService.getSettings();
      res.status(200).json({
        success: true,
        message: 'Public settings retrieved successfully',
        data: { settings: this.systemSettingService.getPublicSettings(settings) },
      });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/settings */
  getAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const settings = await this.systemSettingService.getSettings();
      res.status(200).json({
        success: true,
        message: 'Settings retrieved successfully',
        data: { settings },
      });
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/settings */
  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const patch = req.body || {};
      const settings = await this.systemSettingService.updateSettings(patch);
      await this.record(req, { changed: Object.keys(patch) });
      res.status(200).json({
        success: true,
        message: 'Settings updated successfully',
        data: { settings },
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
