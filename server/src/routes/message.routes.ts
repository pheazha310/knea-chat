import { Router } from 'express';
import type { MessageController } from '../controllers/message.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createMessageRouter = (messageController: MessageController, auth: AuthMiddleware): Router => {
  const router = Router();

  router.post('/', auth.authenticate, messageController.create);

  /**
   * POST /api/messages/upload
   * Multipart form: `conversation_id` + `file`.
   * Creates a `file` type message with an attachments row (SRS FR-17).
   */
  router.post('/upload', auth.authenticate, messageController.uploadFile);

  router.patch('/:id', auth.authenticate, messageController.update);
  router.delete('/:id', auth.authenticate, messageController.remove);
  router.post('/:id/forward', auth.authenticate, messageController.forward);
  router.get('/:id/thread', auth.authenticate, messageController.getThread);
  router.post('/:id/pin', auth.authenticate, messageController.pin);
  router.delete('/:id/pin', auth.authenticate, messageController.unpin);
  router.post('/:id/reactions', auth.authenticate, messageController.addReaction);
  router.delete('/:id/reactions/:reactionType', auth.authenticate, messageController.removeReaction);

  return router;
};
