import { Router } from 'express';
import type { HolidayController } from '../controllers/holiday.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createHolidayRouter = (
  holidayController: HolidayController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  router.get('/', auth.authenticate, holidayController.list);
  router.post('/', auth.authenticate, auth.authorizeAtLeast('manager'), holidayController.create);
  router.put('/:id', auth.authenticate, auth.authorizeAtLeast('manager'), holidayController.update);
  router.delete('/:id', auth.authenticate, auth.authorizeAtLeast('manager'), holidayController.remove);

  return router;
}