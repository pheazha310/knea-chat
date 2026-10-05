/**
 * Integration config routes.
 *
 *   GET    /api/integrations                — list integrations for the user's company
 *   GET    /api/integrations/available     — list all available channels
 *   POST   /api/integrations/:channel      — enable a channel (admin+)
 *   PATCH  /api/integrations/:channel      — update channel config (admin+)
 *   DELETE /api/integrations/:channel      — disable/delete a channel (admin+)
 *   GET    /api/integrations/:channel/health — health check (admin+)
 */
import { Router } from 'express';
import type { IntegrationConfigController } from '../controllers/integrationConfig.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createIntegrationConfigRouter = (
  integrationConfigController: IntegrationConfigController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  router.get('/', auth.authenticate, integrationConfigController.list);
  router.get('/available', auth.authenticate, integrationConfigController.listAvailable);
  router.post('/:channel', auth.authenticate, auth.authorizeAtLeast('admin'), integrationConfigController.enable);
  router.patch('/:channel', auth.authenticate, auth.authorizeAtLeast('admin'), integrationConfigController.updateConfig);
  router.delete('/:channel', auth.authenticate, auth.authorizeAtLeast('admin'), integrationConfigController.disable);
  router.get('/:channel/health', auth.authenticate, auth.authorizeAtLeast('admin'), integrationConfigController.health);

  return router;
};

export default createIntegrationConfigRouter;
