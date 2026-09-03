/**
 * NotificationPreferenceService — per-user opt-outs per notification category.
 *
 * Every category defaults to enabled (no DB row = enabled). `filterEnabled`
 * is the enforcement point: notification creators ask which of their intended
 * recipients actually want a category before inserting rows / pushing live
 * events.
 */
import type { NotificationPreferenceRepository } from '../repositories/notificationPreferenceRepository';
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from '../types';

const VALID_CATEGORIES = new Set<string>(
  NOTIFICATION_CATEGORIES.map((c) => c.category),
);

export class NotificationPreferenceService {
  constructor(private notificationPreferenceRepository: NotificationPreferenceRepository) {}

  async getPreferences(userId: number): Promise<Array<{
    category: NotificationCategory;
    label: string;
    description: string;
    enabled: boolean;
  }>> {
    const rows = await this.notificationPreferenceRepository.findByUser(userId);
    const disabled = new Set(rows.filter((r) => r.enabled === 0).map((r) => r.category));
    return NOTIFICATION_CATEGORIES.map((info) => ({
      category: info.category,
      label: info.label,
      description: info.description,
      enabled: !disabled.has(info.category),
    }));
  }

  async setPreference(
    userId: number,
    category: string,
    enabled: boolean,
  ): Promise<{ category: NotificationCategory; enabled: boolean }> {
    if (!VALID_CATEGORIES.has(category)) {
      throw new Error(`Unknown notification category "${category}"`);
    }
    const typed = category as NotificationCategory;
    await this.notificationPreferenceRepository.set({ user_id: userId, category: typed, enabled });
    return { category: typed, enabled };
  }

  /**
   * Which of the intended recipients have NOT muted this category. Absent
   * rows count as enabled, so fresh users keep receiving everything until
   * they opt out.
   */
  async filterEnabled(
    category: NotificationCategory,
    userIds: number[],
  ): Promise<number[]> {
    const ids = userIds.map(Number);
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return [];
    const disabled = new Set(
      await this.notificationPreferenceRepository.findDisabledUserIds(category, unique),
    );
    return unique.filter((id) => !disabled.has(id));
  }

  async isEnabled(userId: number, category: NotificationCategory): Promise<boolean> {
    return this.notificationPreferenceRepository.isEnabled(userId, category);
  }
}
