import { Router } from 'express';
import type { AuthController } from '../controllers/auth.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';
import { rateLimit } from '../middleware/rateLimit.middleware';

export const createAuthRouter = (authController: AuthController, auth: AuthMiddleware): Router => {
  const router = Router();

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });

  router.post('/register', authLimiter, authController.register);
  router.post('/login', authLimiter, authController.login);
  router.post('/logout', auth.authenticate, authController.logout);
  router.post('/refresh', auth.authenticate, authController.refresh);
  router.post('/forgot-password', authLimiter, authController.forgotPassword);
  router.post('/reset-password', authLimiter, authController.resetPassword);
  router.post('/change-password', auth.authenticate, authController.changePassword);

  /**
   * GET /api/auth/me
   * Return the authenticated user's profile.
   */
  router.get('/me', auth.authenticate, authController.me);

  return router;
};
