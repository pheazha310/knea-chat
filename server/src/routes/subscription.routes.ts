import { Router } from 'express';
import type { SubscriptionController } from '../controllers/subscription.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createSubscriptionRouter = (
  subscriptionController: SubscriptionController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  // Subscription / plan management is reserved for the platform Super Admin.
  router.get('/', auth.authenticate, auth.authorize(['super_admin']), subscriptionController.list);
  router.patch('/:id', auth.authenticate, auth.authorize(['super_admin']), subscriptionController.update);

  return router;
};
