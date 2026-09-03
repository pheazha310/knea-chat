import { Router } from 'express';
import type { SharedFileController } from '../controllers/sharedFile.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createSharedFileRouter = (sharedFileController: SharedFileController, auth: AuthMiddleware): Router => {
  const router = Router();

  router.post('/upload', auth.authenticate, sharedFileController.uploadFile);
  router.get('/', auth.authenticate, sharedFileController.list);
  // NOTE: '/team/:teamId' must stay before '/:id' so "team" isn't parsed as an id.
  router.get('/team/:teamId', auth.authenticate, sharedFileController.listTeamFiles);
  router.get('/search', auth.authenticate, sharedFileController.search);
  router.get('/:id', auth.authenticate, sharedFileController.getById);
  router.patch('/:id', auth.authenticate, sharedFileController.update);
  router.delete('/:id', auth.authenticate, sharedFileController.remove);
  router.get('/:id/download', auth.authenticate, sharedFileController.download);
  router.post('/:id/embed', auth.authenticate, sharedFileController.embed);
  router.get('/:id/shares', auth.authenticate, sharedFileController.listShares);
  router.post('/:id/shares', auth.authenticate, sharedFileController.shareFile);
  router.delete('/:id/shares/:shareId', auth.authenticate, sharedFileController.unshareFile);
  router.post('/:id/versions', auth.authenticate, sharedFileController.uploadVersion);
  router.get('/:id/versions', auth.authenticate, sharedFileController.getVersions);
  router.get('/:id/permissions', auth.authenticate, sharedFileController.getPermissions);
  router.post('/:id/permissions', auth.authenticate, sharedFileController.grantPermission);
  router.delete('/:id/permissions/:userId', auth.authenticate, sharedFileController.revokePermission);

  return router;
};
