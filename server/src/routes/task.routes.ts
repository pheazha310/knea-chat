import { Router } from 'express';
import type { TaskController } from '../controllers/task.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createTaskRouter = (taskController: TaskController, auth: AuthMiddleware): Router => {
  const router = Router();
  router.get('/', auth.authenticate, taskController.list);
  router.post('/', auth.authenticate, taskController.create);
  router.patch('/:id', auth.authenticate, taskController.update);
  router.delete('/:id', auth.authenticate, taskController.remove);
  router.get('/:id/comments', auth.authenticate, taskController.listComments);
  router.post('/:id/comments', auth.authenticate, taskController.addComment);
  router.delete('/:id/comments/:commentId', auth.authenticate, taskController.removeComment);
  router.get('/:id/attachments', auth.authenticate, taskController.listAttachments);
  router.post('/:id/attachments', auth.authenticate, taskController.uploadAttachment);
  router.delete('/:id/attachments/:attachmentId', auth.authenticate, taskController.removeAttachment);
  return router;
};
