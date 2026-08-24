import { Router } from 'express';
import type { AnnouncementController } from '../controllers/announcement.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createAnnouncementRouter = (
  announcementController: AnnouncementController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  // Any authenticated user of the company may read announcements.
  router.get('/', auth.authenticate, announcementController.list);
  router.get('/:id', auth.authenticate, announcementController.getById);

  // Publishing / editing / deleting announcements is manager+ (SRS FR-24).
  router.post('/', auth.authenticate, auth.authorizeAtLeast('manager'), announcementController.create);
  router.patch('/:id', auth.authenticate, auth.authorizeAtLeast('manager'), announcementController.update);
  router.delete('/:id', auth.authenticate, auth.authorizeAtLeast('manager'), announcementController.remove);

  return router;
};
