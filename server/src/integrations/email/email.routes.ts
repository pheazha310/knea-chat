/**
 * Email routes.
 *
 *   POST   /api/email/webhook         — public (email provider calls it)
 *   GET    /api/email/health          — public
 *   POST   /api/email/messages        — any authenticated agent
 *   POST   /api/email/conversations/:id/assign    — any inbox member
 *   DELETE /api/email/conversations/:id/assign    — any inbox member
 *   POST   /api/email/setup-webhook    — admin+
 *   GET    /api/email/webhook-info     — admin+
 *   DELETE /api/email/webhook          — admin+
 */
import { Router } from 'express';
import type { EmailController } from './email.controller';
import type { AuthMiddleware } from '../../middleware/auth.middleware';

export const createEmailRouter = (
  emailController: EmailController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  router.post('/webhook', emailController.webhook);
  router.get('/health', emailController.health);
  router.post('/messages', auth.authenticate, emailController.sendMessage);
  router.post('/conversations/:id/assign', auth.authenticate, emailController.assignAgent);
  router.delete('/conversations/:id/assign', auth.authenticate, emailController.unassignAgent);
  router.post('/setup-webhook', auth.authenticate, auth.authorizeAtLeast('admin'), emailController.setupWebhook);
  router.get('/webhook-info', auth.authenticate, auth.authorizeAtLeast('admin'), emailController.getWebhookInfo);
  router.delete('/webhook', auth.authenticate, auth.authorizeAtLeast('admin'), emailController.deleteWebhook);

  return router;
};

export default createEmailRouter;
