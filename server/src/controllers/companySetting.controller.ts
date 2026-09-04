/**
 * CompanySettingController — MVC controller layer for the Company Admin
 * console's "Company settings", "Security settings", "Manage permissions"
 * and plan-info endpoints. All handlers act on the requester's own company;
 * access is admin+ (enforced on the routes).
 */
import type { NextFunction, Request, Response } from 'express';
import type { AuditLogService } from '../services/AuditLog.service';
import type { CompanySettingService } from '../services/CompanySetting.service';
import type { PermissionService } from '../services/Permission.service';
import type { SubscriptionService } from '../services/Subscription.service';

export class CompanySettingController {
  constructor(
    private companySettingService: CompanySettingService,
    private permissionService: PermissionService,
    private subscriptionService: SubscriptionService,
    private auditLogService?: AuditLogService | null,
  ) {}

  private async record(req: Request, action: string, details?: Record<string, unknown>): Promise<void> {
    if (!this.auditLogService) return;
    await this.auditLogService.log({
      company_id: req.user!.companyId,
      actor_user_id: req.user!.id,
      actor_role: req.user!.role,
      action,
      entity_type: 'company_settings',
      entity_id: req.user!.companyId,
      details,
      ip_address: req.ip,
    });
  }

  /** GET /api/company-settings — settings + workspace profile in one call. */
  getSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [settings, company] = await Promise.all([
        this.companySettingService.getSettings(req.user!.companyId),
        this.companySettingService.updateProfile(req.user!.companyId, {}).catch(() => null),
      ]);
      res.status(200).json({
        success: true,
        message: 'Workspace settings retrieved successfully',
        data: { settings, company },
      });
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/company-settings — update profile and/or settings. */
  updateSettings = async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = req.user!.companyId;
      const { name, logo, settings } = req.body || {};
      const changed: string[] = [];

      const companyPatch: Record<string, unknown> = {};
      if (name !== undefined) companyPatch.name = name;
      if (logo !== undefined) companyPatch.logo = logo;

      let company = null;
      if (Object.keys(companyPatch).length > 0) {
        company = await this.companySettingService.updateProfile(companyId, companyPatch);
        changed.push(...Object.keys(companyPatch));
      }

      let updatedSettings = null;
      if (settings && typeof settings === 'object' && Object.keys(settings).length > 0) {
        updatedSettings = await this.companySettingService.updateSettings(companyId, settings);
        changed.push(...Object.keys(settings));
      }

      if (changed.length > 0) {
        await this.record(req, 'company_settings.updated', { changed });
      }

      const [currentSettings, currentCompany] = await Promise.all([
        this.companySettingService.getSettings(companyId),
        company ?? this.companySettingService.updateProfile(companyId, {}).catch(() => null),
      ]);

      res.status(200).json({
        success: true,
        message: 'Workspace settings updated successfully',
        data: { settings: updatedSettings ?? currentSettings, company: currentCompany },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/company-settings/permissions — matrix for this company. */
  getPermissions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [matrix, catalog] = await Promise.all([
        this.permissionService.getMatrix(req.user!.companyId),
        Promise.resolve(this.permissionService.getCatalog()),
      ]);
      res.status(200).json({
        success: true,
        message: 'Permission matrix retrieved successfully',
        data: { matrix, catalog },
      });
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/company-settings/permissions — set or reset one cell. */
  updatePermission = async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = req.user!.companyId;
      const { role, permission_key, allowed } = req.body || {};

      if (!role || !permission_key) {
        res.status(400).json({
          success: false,
          message: 'role and permission_key are required',
          errors: { validation: 'Required: role, permission_key, allowed' },
        });
        return;
      }

      if (allowed === null || allowed === undefined || allowed === 'default') {
        await this.permissionService.resetOverride(companyId, String(role), permission_key);
      } else {
        await this.permissionService.setOverride(
          companyId,
          String(role),
          permission_key,
          allowed === true || allowed === 'true' || allowed === 1 || allowed === '1',
          req.user!.id,
        );
      }
      await this.record(req, 'permissions.updated', { role, permission_key, allowed });

      const matrix = await this.permissionService.getMatrix(companyId);
      res.status(200).json({
        success: true,
        message: 'Permission updated successfully',
        data: { matrix },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/company-settings/plan — the workspace's own plan + usage. */
  getPlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const subscription = await this.subscriptionService.getCompanySubscription(
        req.user!.companyId,
      );
      res.status(200).json({
        success: true,
        message: 'Workspace plan retrieved successfully',
        data: { subscription },
      });
    } catch (error) {
      next(error);
    }
  };
}
