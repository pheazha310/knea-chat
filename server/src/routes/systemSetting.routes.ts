import { Router } from 'express';
import type { SystemSettingController } from '../controllers/systemSetting.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createSystemSettingRouter = (
  systemSettingController: SystemSettingController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  /**
   * Public subset of platform settings — no authentication so the login page
   * can render registration / maintenance state before the user signs in.
   */
  router.get('/public', systemSettingController.getPublic);

  // Everything below is reserved for the platform Super Admin.
  router.use(auth.authenticate, auth.authorizeAtLeast('super_admin'));

  router.get('/', systemSettingController.getAll);
  router.patch('/', systemSettingController.update);

  return router;
};
