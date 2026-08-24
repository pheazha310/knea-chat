/**
 * ReminderService — business logic for message reminders.
 *
 * Fires a notification when a reminder is due. The server's reminder scheduler
 * (see server.ts) polls for due reminders and calls `processDueReminders`.
 */
import type { ReminderRepository } from '../repositories/reminderRepository';
import type { NotificationRepository } from '../repositories/notificationRepository';
import type { MessageRepository } from '../repositories/messageRepository';
import { sendToUser } from '../websocket/connection.registry';

export interface ReminderData {
  messageId: number;
  userId: number;
  remindAt: Date | string;
}

export class ReminderService {
  constructor(
    private reminderRepository: ReminderRepository,
    private notificationRepository: NotificationRepository,
    private messageRepository: MessageRepository,
  ) {}

  async setReminder(data: ReminderData): Promise<{ id: number }> {
    const message = await this.messageRepository.findById(data.messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    const id = await this.reminderRepository.create({
      message_id: data.messageId,
      user_id: data.userId,
      remind_at: data.remindAt,
    });

    return { id };
  }

  async cancelReminder(messageId: number, userId: number): Promise<boolean> {
    const message = await this.messageRepository.findById(messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    const existing = await this.reminderRepository.findByMessageAndUser(messageId, userId);
    if (!existing) return false;
    return this.reminderRepository.delete(existing.id, userId);
  }

  async getMyReminder(messageId: number, userId: number): Promise<{ id: number; remind_at: string } | null> {
    const message = await this.messageRepository.findById(messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    const existing = await this.reminderRepository.findByMessageAndUser(messageId, userId);
    if (!existing) return null;
    return { id: existing.id, remind_at: String(existing.remind_at) };
  }

  async processDueReminders(now: Date | string): Promise<void> {
    const due = await this.reminderRepository.findDueReminders(now);
    if (due.length === 0) return;

    const ids: number[] = [];
    for (const reminder of due) {
      try {
        const message = await this.messageRepository.findByIdWithSender(reminder.message_id);
        if (!message) continue;

        const senderName = `${message.first_name || ''} ${message.last_name || ''}`.trim() || 'Someone';
        const shortContent = message.content.length > 120 ? message.content.slice(0, 117) + '...' : message.content;

        await this.notificationRepository.create({
          user_id: reminder.user_id,
          actor_id: message.sender_id,
          type: 'message_reminder',
          title: 'Message reminder',
          message: `${senderName}: "${shortContent}"`,
          data: {
            messageId: reminder.message_id,
            conversationId: message.conversation_id,
            remindAt: String(reminder.remind_at),
          },
        });

        sendToUser(reminder.user_id, {
          type: 'reminder',
          reminderId: reminder.id,
          messageId: reminder.message_id,
          conversationId: message.conversation_id,
          title: 'Message reminder',
          body: `${senderName}: "${shortContent}"`,
        });

        ids.push(reminder.id);
      } catch {
        // Skip failed reminders so the scheduler can retry on the next tick.
      }
    }

    if (ids.length > 0) {
      await this.reminderRepository.markAsSent(ids);
    }
  }
}
