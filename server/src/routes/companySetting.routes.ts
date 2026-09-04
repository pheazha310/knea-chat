import { Router } from 'express';
import type { CompanySettingController } from '../controllers/companySetting.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createCompanySettingRouter = (
  companySettingController: CompanySettingController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  // Company settings / security settings (workspace-scoped, admin+).
  router.get('/', auth.authenticate, auth.authorizeAtLeast('admin'), companySettingController.getSettings);
  router.patch('/', auth.authenticate, auth.authorizeAtLeast('admin'), companySettingController.updateSettings);

  // Manage permissions (admin+ on their own company).
  router.get('/permissions', auth.authenticate, auth.authorizeAtLeast('admin'), companySettingController.getPermissions);
  router.patch('/permissions', auth.authenticate, auth.authorizeAtLeast('admin'), companySettingController.updatePermission);

  // The workspace's own subscription / plan (admin+ reads it here).
  router.get('/plan', auth.authenticate, auth.authorizeAtLeast('admin'), companySettingController.getPlan);

  return router;
};
