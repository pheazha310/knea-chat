import { Router } from 'express';
import type { ConversationController } from '../controllers/conversation.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createConversationRouter = (
  conversationController: ConversationController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  router.get('/', auth.authenticate, conversationController.list);
  router.post('/', auth.authenticate, conversationController.create);
  router.get('/:id', auth.authenticate, conversationController.getById);
  router.post('/:id/members', auth.authenticate, conversationController.addMember);
  router.get('/:id/messages', auth.authenticate, conversationController.getMessages);
  router.post('/direct', auth.authenticate, conversationController.createDirect);

  return router;
};
