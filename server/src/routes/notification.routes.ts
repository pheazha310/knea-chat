import { Router } from 'express';
import type { NotificationController } from '../controllers/notification.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createNotificationRouter = (
  notificationController: NotificationController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  router.get('/', auth.authenticate, notificationController.list);
  router.patch('/:id/read', auth.authenticate, notificationController.markAsRead);
  router.post('/read-all', auth.authenticate, notificationController.markAllAsRead);
  router.delete('/:id', auth.authenticate, notificationController.remove);

  return router;
};
