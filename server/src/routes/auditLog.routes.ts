import { Router } from 'express';
import type { AuditLogController } from '../controllers/auditLog.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createAuditLogRouter = (
  auditLogController: AuditLogController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  // Company Admin console — this company's trail.
  router.get('/', auth.authenticate, auth.authorizeAtLeast('admin'), auditLogController.list);

  // Super Admin console — platform-wide trail (platform-only via ?company_only=platform).
  router.get('/platform', auth.authenticate, auth.authorize(['super_admin']), auditLogController.listPlatform);

  return router;
};
