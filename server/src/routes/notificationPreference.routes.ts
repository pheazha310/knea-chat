import { Router } from 'express';
import type { NotificationPreferenceController } from '../controllers/notificationPreference.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createNotificationPreferenceRouter = (
  notificationPreferenceController: NotificationPreferenceController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();
  router.get('/', auth.authenticate, notificationPreferenceController.get);
  router.put('/', auth.authenticate, notificationPreferenceController.set);
  return router;
};
