/**
 * Omni-channel routes.
 *
 *   GET    /api/omni/health/:channel     — public
 *   GET    /api/omni/capabilities        — public per-channel capabilities
 *   POST   /api/omni/conversations/:id/assign   — any inbox member
 *   DELETE /api/omni/conversations/:id/assign   — any inbox member
 *   PATCH  /api/omni/conversations/:id/status   — any inbox member
 *   POST   /api/omni/conversations/:id/messages — agent reply (any channel)
 *   POST   /api/omni/conversations/:id/media    — agent file/voice reply
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

  // Public per-channel capability map (e.g. which channels relay media).
  router.get('/capabilities', omniController.capabilities);

  // Shared inbox actions for any external conversation.
  router.post('/conversations/:id/assign', auth.authenticate, omniController.assignConversation);
  router.delete('/conversations/:id/assign', auth.authenticate, omniController.unassignConversation);
  router.patch('/conversations/:id/status', auth.authenticate, omniController.setStatus);
  router.post('/conversations/:id/messages', auth.authenticate, omniController.sendMessage);
  router.post('/conversations/:id/media', auth.authenticate, omniController.sendMedia);

  return router;
};

export default createOmniRouter;