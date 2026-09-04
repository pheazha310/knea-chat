/**
 * PlatformMetricService — live platform statistics for the Super Admin
 * monitoring dashboard. Reads DB-derived aggregates only; nothing here
 * mutates state.
 */
import type { PlatformMetricRepository } from '../repositories/platformMetricRepository';
import type { PlatformMetrics } from '../types';

export class PlatformMetricService {
  constructor(private platformMetricRepository: PlatformMetricRepository) {}

  async getMetrics(): Promise<PlatformMetrics> {
    const [totals, onlineUsers, today, storage, weeklyMessages] = await Promise.all([
      this.platformMetricRepository.getCounts(),
      this.platformMetricRepository.countOnlineUsers(),
      this.platformMetricRepository.getToday(),
      this.platformMetricRepository.getStorage(),
      this.platformMetricRepository.getWeeklyMessages(7),
    ]);

    // Fill empty days so the 7-day chart always has seven buckets.
    const byDay = new Map<string, number>();
    for (const row of weeklyMessages) byDay.set(String(row.day), Number(row.messages));
    const days: Array<{ day: string; messages: number }> = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ day: key, messages: byDay.get(key) || 0 });
    }

    return {
      totals,
      online_users: onlineUsers,
      today,
      storage,
      weekly_messages: days,
    };
  }
}
