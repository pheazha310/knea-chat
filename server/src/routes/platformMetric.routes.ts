import { Router } from 'express';
import type { PlatformMetricController } from '../controllers/platformMetric.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createPlatformMetricRouter = (
  platformMetricController: PlatformMetricController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  // Platform monitoring is reserved for the Super Admin.
  router.get('/', auth.authenticate, auth.authorize(['super_admin']), platformMetricController.metrics);

  return router;
};
