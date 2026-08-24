/**
 * NotificationService — business logic for the notification center.
 * Thin pass-through over NotificationRepository; ownership/business rules can
 * be added here without changing controllers or the repository.
 */
import type { NotificationRepository } from '../repositories/notificationRepository';
import type { NotificationRow } from '../types';

export class NotificationService {
  constructor(private notificationRepository: NotificationRepository) {}

  async getNotifications(
    userId: number,
    filters: { page?: number; limit?: number; is_read?: string } = {},
  ): Promise<{ notifications: NotificationRow[]; unreadCount: number }> {
    const { page = 1, limit = 20, is_read = '' } = filters;
    const notifications = await this.notificationRepository.findAll({
      userId,
      page: parseInt(String(page)),
      limit: parseInt(String(limit)),
      is_read,
    });
    const unreadCount = await this.notificationRepository.getUnreadCount(userId);
    return { notifications, unreadCount };
  }

  async markAsRead(notificationId: number): Promise<boolean> {
    return this.notificationRepository.markAsRead(notificationId);
  }

  async markAllAsRead(userId: number): Promise<boolean> {
    return this.notificationRepository.markAllAsRead(userId);
  }

  async remove(notificationId: number): Promise<boolean> {
    return this.notificationRepository.delete(notificationId);
  }
}
