import { Router } from 'express';
import type { BookmarkController } from '../controllers/bookmark.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

/** POST/DELETE /api/messages/:id/bookmarks */
export const createBookmarkMessageRouter = (
  bookmarkController: BookmarkController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  router.post('/:id/bookmarks', auth.authenticate, bookmarkController.add);
  router.delete('/:id/bookmarks', auth.authenticate, bookmarkController.remove);

  return router;
};

/** GET /api/bookmarks */
export const createBookmarkListRouter = (
  bookmarkController: BookmarkController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  router.get('/', auth.authenticate, bookmarkController.list);

  return router;
};
