import { Router } from 'express';
import type { AnnouncementController } from '../controllers/announcement.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createAnnouncementRouter = (
  announcementController: AnnouncementController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  // Any authenticated user of the company may read announcements (the service
  // scopes the list to what the viewer is allowed to see).
  router.get('/', auth.authenticate, announcementController.list);
  router.get('/:id', auth.authenticate, announcementController.getById);
  // Read confirmation: anyone may mark announcements read; the reader list
  // (who read what) is manager+.
  router.post('/:id/read', auth.authenticate, announcementController.markRead);
  router.get('/:id/reads', auth.authenticate, auth.authorizeAtLeast('manager'), announcementController.readers);

  // Emoji reactions — any authenticated user who can see the announcement.
  router.post('/:id/reactions', auth.authenticate, announcementController.addReaction);
  router.delete('/:id/reactions/:reactionType', auth.authenticate, announcementController.removeReaction);

  // Publishing / editing / deleting announcements consults the discretionary
  // permission catalog (Company Admins may restrict managers); baseline
  // manager+ (SRS FR-24).
  router.post('/', auth.authenticate, auth.authorizeCapability('publish_announcements'), announcementController.create);
  router.patch('/:id', auth.authenticate, auth.authorizeCapability('publish_announcements'), announcementController.update);
  router.delete('/:id', auth.authenticate, auth.authorizeCapability('publish_announcements'), announcementController.remove);

  return router;
};