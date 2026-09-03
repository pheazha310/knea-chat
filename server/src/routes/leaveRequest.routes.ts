import { Router } from 'express';
import type { LeaveRequestController } from '../controllers/leaveRequest.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createLeaveRequestRouter = (
  leaveRequestController: LeaveRequestController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  router.post('/', auth.authenticate, leaveRequestController.create);
  router.get('/', auth.authenticate, leaveRequestController.list);
  router.put('/:id/approve', auth.authenticate, auth.authorizeAtLeast('manager'), leaveRequestController.approve);
  router.put('/:id/reject', auth.authenticate, auth.authorizeAtLeast('manager'), leaveRequestController.reject);

  return router;
}