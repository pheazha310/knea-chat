/**
 * Omni-channel routes.
 *
 *   GET    /api/omni/health/:channel     — public
 *   POST   /api/omni/conversations/:id/assign   — any inbox member
 *   DELETE /api/omni/conversations/:id/assign   — any inbox member
 *   PATCH  /api/omni/conversations/:id/status   — any inbox member
 *   POST   /api/omni/conversations/:id/messages — agent reply (any channel)
 *
 * Channel webhooks are deliberately NOT mounted here: each channel exposes its
 * own provider-specific webhook route with its own secret validation (see
 * `/api/telegram/webhook`) so no channel can be reached through a generic
 * public route.
 */
import { Router } from 'express';
import type { OmniController } from './omni.controller';
import type { AuthMiddleware } from '../../middleware/auth.middleware';

export const createOmniRouter = (
  omniController: OmniController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  // Public health probe (never exposes secrets).
  router.get('/health/:channel', omniController.health);

  // Shared inbox actions for any external conversation.
  router.post('/conversations/:id/assign', auth.authenticate, omniController.assignConversation);
  router.delete('/conversations/:id/assign', auth.authenticate, omniController.unassignConversation);
  router.patch('/conversations/:id/status', auth.authenticate, omniController.setStatus);
  router.post('/conversations/:id/messages', auth.authenticate, omniController.sendMessage);

  return router;
};

export default createOmniRouter;