import { Router } from 'express';
import type { SharedFileController } from '../controllers/sharedFile.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createSharedFileRouter = (sharedFileController: SharedFileController, auth: AuthMiddleware): Router => {
  const router = Router();

  router.post('/upload', auth.authenticate, sharedFileController.uploadFile);
  router.get('/', auth.authenticate, sharedFileController.list);
  router.get('/search', auth.authenticate, sharedFileController.search);
  router.get('/:id', auth.authenticate, sharedFileController.getById);
  router.patch('/:id', auth.authenticate, sharedFileController.update);
  router.delete('/:id', auth.authenticate, sharedFileController.remove);
  router.get('/:id/download', auth.authenticate, sharedFileController.download);
  router.post('/:id/versions', auth.authenticate, sharedFileController.uploadVersion);
  router.get('/:id/versions', auth.authenticate, sharedFileController.getVersions);
  router.get('/:id/permissions', auth.authenticate, sharedFileController.getPermissions);
  router.post('/:id/permissions', auth.authenticate, sharedFileController.grantPermission);
  router.delete('/:id/permissions/:userId', auth.authenticate, sharedFileController.revokePermission);

  return router;
};
