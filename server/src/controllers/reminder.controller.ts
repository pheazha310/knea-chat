/**
 * ReminderController — MVC controller for message reminders.
 *
 * Endpoints:
 *  POST /api/messages/:id/remind        — set a 1-hour reminder
 *  DELETE /api/messages/:id/remind      — cancel reminder
 *  GET /api/messages/:id/remind         — check reminder status
 */
import type { NextFunction, Request, Response } from 'express';
import type { ReminderService } from '../services/Reminder.service';

export class ReminderController {
  constructor(private reminderService: ReminderService) {}

  setReminder = async (req: Request, res: Response): Promise<void> => {
    try {
      const messageId = parseInt(String(req.params.id), 10);
      const userId = req.user!.id;

      if (!Number.isFinite(messageId) || messageId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid message ID', errors: {} });
        return;
      }

      const remindAt = new Date(Date.now() + 60 * 60 * 1000);
      const { id } = await this.reminderService.setReminder({
        messageId,
        userId,
        remindAt,
      });

      res.status(201).json({
        success: true,
        message: 'Reminder set for 1 hour',
        data: { reminderId: id, remind_at: remindAt.toISOString() },
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'Message not found') {
        res.status(404).json({ success: false, message, errors: {} });
      } else {
        res.status(400).json({ success: false, message, errors: {} });
      }
    }
  };

  cancelReminder = async (req: Request, res: Response): Promise<void> => {
    try {
      const messageId = parseInt(String(req.params.id), 10);
      const userId = req.user!.id;

      if (!Number.isFinite(messageId) || messageId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid message ID', errors: {} });
        return;
      }

      const removed = await this.reminderService.cancelReminder(messageId, userId);

      res.status(200).json({
        success: true,
        message: removed ? 'Reminder cancelled' : 'No reminder to cancel',
        data: { removed },
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'Message not found') {
        res.status(404).json({ success: false, message, errors: {} });
      } else {
        res.status(400).json({ success: false, message, errors: {} });
      }
    }
  };

  getReminder = async (req: Request, res: Response): Promise<void> => {
    try {
      const messageId = parseInt(String(req.params.id), 10);
      const userId = req.user!.id;

      if (!Number.isFinite(messageId) || messageId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid message ID', errors: {} });
        return;
      }

      const reminder = await this.reminderService.getMyReminder(messageId, userId);

      res.status(200).json({
        success: true,
        data: reminder,
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'Message not found') {
        res.status(404).json({ success: false, message, errors: {} });
      } else {
        // Graceful degradation: return 200 with null data so the client
        // caches "no reminder" instead of retrying on every render.
        console.error('[ReminderController] getReminder error:', message);
        res.status(200).json({ success: true, data: null });
      }
    }
  };
}
