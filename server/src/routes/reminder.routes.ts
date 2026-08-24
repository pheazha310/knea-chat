import { Router } from 'express';
import type { ReminderController } from '../controllers/reminder.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createReminderRouter = (reminderController: ReminderController, auth: AuthMiddleware): Router => {
  const router = Router();

  router.post('/:id/remind', auth.authenticate, reminderController.setReminder);
  router.delete('/:id/remind', auth.authenticate, reminderController.cancelReminder);
  router.get('/:id/remind', auth.authenticate, reminderController.getReminder);

  return router;
};
