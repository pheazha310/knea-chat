/**
 * AuditLogController — MVC controller layer.
 *
 * Serves the audit trails for both consoles: GET /api/audit-logs returns the
 * requester's company trail (admin+); GET /api/audit-logs/platform returns
 * the whole platform trail (Super Admin only, enforced on the routes).
 */
import type { NextFunction, Request, Response } from 'express';
import type { AuditLogService } from '../services/AuditLog.service';

export class AuditLogController {
  constructor(private auditLogService: AuditLogService) {}

  /** GET /api/audit-logs — this company's trail. */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { action = '', entity_type = '', limit = 100 } = req.query;
      const logs = await this.auditLogService.listForCompany(req.user!.companyId, {
        action: String(action) || undefined,
        entity_type: String(entity_type) || undefined,
        limit: Number(limit),
      });
      res.status(200).json({
        success: true,
        message: 'Audit log retrieved successfully',
        data: { logs },
      });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/audit-logs/platform — every company + platform-scope action. */
  listPlatform = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { action = '', entity_type = '', company_only = '', limit = 100 } = req.query;
      const scope = String(company_only);
      const filters = {
        action: String(action) || undefined,
        entity_type: String(entity_type) || undefined,
        limit: Number(limit),
      };
      const logs =
        scope === 'platform'
          ? await this.auditLogService.listPlatformOnly(filters)
          : await this.auditLogService.listPlatform(filters);
      res.status(200).json({
        success: true,
        message: 'Platform audit log retrieved successfully',
        data: { logs },
      });
    } catch (error) {
      next(error);
    }
  };
}
