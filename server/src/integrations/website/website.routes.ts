/**
 * Website routes.
 *
 *   POST   /api/website/webhook         — public (website widget calls it)
 *   GET    /api/website/health          — public
 *   POST   /api/website/messages        — any authenticated agent
 *   POST   /api/website/conversations/:id/assign    — any inbox member
 *   DELETE /api/website/conversations/:id/assign    — any inbox member
 */
import { Router } from 'express';
import type { WebsiteController } from './website.controller';
import type { AuthMiddleware } from '../../middleware/auth.middleware';

export const createWebsiteRouter = (
  websiteController: WebsiteController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  router.post('/webhook', websiteController.webhook);
  router.get('/health', websiteController.health);
  router.post('/messages', auth.authenticate, websiteController.sendMessage);
  router.post('/conversations/:id/assign', auth.authenticate, websiteController.assignAgent);
  router.delete('/conversations/:id/assign', auth.authenticate, websiteController.unassignAgent);

  return router;
};

export default createWebsiteRouter;
