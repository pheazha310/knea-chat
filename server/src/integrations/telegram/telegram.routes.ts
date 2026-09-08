/**
 * Telegram routes.
 *
 * Access model:
 *   POST   /api/telegram/webhook         — public (Telegram Bot API calls it)
 *   GET    /api/telegram/health          — public (no secrets returned)
 *   POST   /api/telegram/messages        — any authenticated agent
 *   POST   /api/telegram/conversations/:id/assign    — any inbox member (claim)
 *   DELETE /api/telegram/conversations/:id/assign    — any inbox member (unassign)
 *   POST   /api/telegram/setup-webhook   — admin+ (webhook administration)
 *   GET    /api/telegram/webhook-info    — admin+
 *   DELETE /api/telegram/webhook         — admin+
 */
import { Router } from 'express';
import type { TelegramController } from './telegram.controller';
import type { AuthMiddleware } from '../../middleware/auth.middleware';

export const createTelegramRouter = (
  telegramController: TelegramController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  // Public — Telegram's webhook delivery and the health probe.
  router.post('/webhook', telegramController.webhook);
  router.get('/health', telegramController.health);

  // Authenticated agents reply to Telegram conversations from the inbox.
  router.post('/messages', auth.authenticate, telegramController.sendMessage);

  // Agent assignment (claim/unassign) — any inbox member.
  router.post('/conversations/:id/assign', auth.authenticate, telegramController.assignAgent);
  router.delete('/conversations/:id/assign', auth.authenticate, telegramController.unassignAgent);

  // Webhook administration is restricted to administrators (the endpoint can
  // point the bot at any public URL and reveals its configuration).
  router.post('/setup-webhook', auth.authenticate, auth.authorizeAtLeast('admin'), telegramController.setupWebhook);
  router.get('/webhook-info', auth.authenticate, auth.authorizeAtLeast('admin'), telegramController.getWebhookInfo);
  router.delete('/webhook', auth.authenticate, auth.authorizeAtLeast('admin'), telegramController.deleteWebhook);

  return router;
};

export default createTelegramRouter;