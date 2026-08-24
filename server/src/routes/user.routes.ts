import { Router } from 'express';
import type { UserController } from '../controllers/user.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createUserRouter = (userController: UserController, auth: AuthMiddleware): Router => {
  const router = Router();

  router.get('/', auth.authenticate, userController.list);
  router.get('/search', auth.authenticate, userController.search);
  router.get('/:id', auth.authenticate, userController.getById);
  router.post('/', auth.authenticate, auth.authorizeAtLeast('admin'), userController.create);

  /**
   * POST /api/users/:id/avatar
   * Multipart form: `avatar` file. Stores the file under /uploads and saves its
   * URL in `profile_picture` — the column is VARCHAR(500), so a base64 data URL
   * (which can be megabytes) must never be sent through PATCH /users/:id.
   */
  router.post('/:id/avatar', auth.authenticate, userController.uploadAvatar);

  router.patch('/:id', auth.authenticate, userController.update);
  router.delete('/:id', auth.authenticate, auth.authorizeAtLeast('admin'), userController.remove);

  return router;
};
