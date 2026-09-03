import { Router } from 'express';
import type { WorkScheduleController } from '../controllers/workSchedule.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createWorkScheduleRouter = (
  workScheduleController: WorkScheduleController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  // Managers can list all schedules; the per-employee route also allows
  // employees to read their own schedule (checked inside the controller).
  router.get('/', auth.authenticate, auth.authorizeAtLeast('manager'), workScheduleController.list);
  router.get('/:employeeId', auth.authenticate, workScheduleController.getByEmployee);
  router.post('/', auth.authenticate, auth.authorizeAtLeast('manager'), workScheduleController.create);
  router.put('/:id', auth.authenticate, auth.authorizeAtLeast('manager'), workScheduleController.update);
  router.delete('/:id', auth.authenticate, auth.authorizeAtLeast('manager'), workScheduleController.remove);

  return router;
}