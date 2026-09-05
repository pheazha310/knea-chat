/**
 * NotificationService — business logic for the notification center.
 *
 * Beyond the thin repository pass-through, the list endpoint enriches every
 * notification whose target can carry emoji reactions (a message, an
 * announcement or a task) with that target's current reaction list, so the
 * notification rows can show who reacted without an extra round-trip per row.
 */
import type { NotificationRepository } from '../repositories/notificationRepository';
import type { MessageRepository } from '../repositories/messageRepository';
import type { AnnouncementRepository } from '../repositories/announcementRepository';
import type { TaskRepository } from '../repositories/taskRepository';
import type { NotificationRow } from '../types';

const MESSAGE_TYPES = new Set(['mention', 'new_message']);
const TASK_TYPES = new Set(['task_assigned', 'task_deadline']);

/** Read the JSON `data` column (string) into an object, tolerating bad rows. */
const parseData = (raw: string | null): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const positiveId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
};

export class NotificationService {
  constructor(
    private notificationRepository: NotificationRepository,
    private messageRepository?: MessageRepository | null,
    private announcementRepository?: AnnouncementRepository | null,
    private taskRepository?: TaskRepository | null,
  ) {}

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
    await this.attachReactions(notifications);
    return { notifications, unreadCount };
  }

  /**
   * Attach `reactions` to rows whose target has a reaction model. Runs at
   * most one bulk query per domain, so a full page of notifications costs a
   * handful of queries regardless of how many rows point at each domain.
   */
  private async attachReactions(notifications: NotificationRow[]): Promise<void> {
    const messageIds = new Set<number>();
    const announcementIds = new Set<number>();
    const taskIds = new Set<number>();

    for (const notification of notifications) {
      const data = parseData(notification.data);
      if (!data) continue;
      if (MESSAGE_TYPES.has(notification.type)) {
        const id = positiveId(data.messageId);
        if (id !== null) messageIds.add(id);
      } else if (notification.type === 'announcement') {
        const id = positiveId(data.announcementId);
        if (id !== null) announcementIds.add(id);
      } else if (TASK_TYPES.has(notification.type)) {
        const id = positiveId(data.taskId);
        if (id !== null) taskIds.add(id);
      }
    }

    const [messages, announcements, tasks] = await Promise.all([
      this.messageRepository && messageIds.size > 0
        ? this.messageRepository.findReactionsByMessageIds(Array.from(messageIds))
        : [],
      this.announcementRepository && announcementIds.size > 0
        ? this.announcementRepository.findReactionsByAnnouncementIds(Array.from(announcementIds))
        : [],
      this.taskRepository && taskIds.size > 0
        ? this.taskRepository.findReactionsByTaskIds(Array.from(taskIds))
        : [],
    ]);

    const messageByTarget = this.groupBy(messages as Array<{ message_id: number }>, 'message_id');
    const announcementByTarget = this.groupBy(
      announcements as Array<{ announcement_id: number }>,
      'announcement_id',
    );
    const taskByTarget = this.groupBy(tasks as Array<{ task_id: number }>, 'task_id');

    for (const notification of notifications) {
      const data = parseData(notification.data);
      if (!data) continue;
      if (MESSAGE_TYPES.has(notification.type) && this.messageRepository) {
        const id = positiveId(data.messageId);
        if (id !== null) notification.reactions = messageByTarget.get(id) || [];
      } else if (notification.type === 'announcement' && this.announcementRepository) {
        const id = positiveId(data.announcementId);
        if (id !== null) notification.reactions = announcementByTarget.get(id) || [];
      } else if (TASK_TYPES.has(notification.type) && this.taskRepository) {
        const id = positiveId(data.taskId);
        if (id !== null) notification.reactions = taskByTarget.get(id) || [];
      }
    }
  }

  private groupBy<T extends Record<string, unknown>>(
    rows: T[],
    key: string,
  ): Map<number, T[]> {
    const map = new Map<number, T[]>();
    for (const row of rows) {
      const id = Number(row[key]);
      if (!Number.isFinite(id)) continue;
      const list = map.get(id) || [];
      list.push(row);
      map.set(id, list);
    }
    return map;
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
