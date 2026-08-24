/**
 * AnnouncementService — business logic for company-wide announcements
 * (SRS FR-24). Publishing is manager+ (enforced at the route layer); every
 * user in the company receives an `announcement` notification row so the
 * bell (and Notifications view) surfaces the announcement immediately.
 */
import type { AnnouncementRepository } from '../repositories/announcementRepository';
import type { NotificationRepository } from '../repositories/notificationRepository';
import type { UserRepository } from '../repositories/userRepository';
import type { AnnouncementRow } from '../types';

export class AnnouncementService {
  constructor(
    private announcementRepository: AnnouncementRepository,
    private notificationRepository: NotificationRepository,
    private userRepository: UserRepository,
  ) {}

  async getAnnouncements(companyId: number): Promise<AnnouncementRow[]> {
    return this.announcementRepository.findAll(companyId);
  }

  async getAnnouncement(id: number): Promise<AnnouncementRow> {
    const announcement = await this.announcementRepository.findById(id);
    if (!announcement) {
      throw new Error('Announcement not found');
    }
    return announcement;
  }

  async createAnnouncement(data: {
    company_id: number;
    title: string;
    content: string;
    created_by: number;
  }): Promise<AnnouncementRow> {
    const { company_id, title, content, created_by } = data;

    const trimmedTitle = (title || '').trim();
    const trimmedContent = (content || '').trim();
    if (!trimmedTitle) {
      throw new Error('Announcement title is required');
    }
    if (!trimmedContent) {
      throw new Error('Announcement content is required');
    }

    const announcementId = await this.announcementRepository.create({
      company_id,
      title: trimmedTitle,
      content: trimmedContent,
      created_by,
    });

    // Notify every user in the company (except the publisher) so the
    // announcement shows up in the bell / Notifications view.
    try {
      const memberIds = await this.userRepository.findCompanyUserIds(company_id);
      const snippet = trimmedContent.length > 120
        ? `${trimmedContent.slice(0, 120)}…`
        : trimmedContent;
      for (const userId of memberIds) {
        if (Number(userId) === Number(created_by)) continue;
        await this.notificationRepository.create({
          user_id: userId,
          actor_id: created_by,
          type: 'announcement',
          title: trimmedTitle,
          message: snippet,
          data: { announcementId },
        });
      }
    } catch (error) {
      // Notification failures must never break announcement delivery.
      console.error('[AnnouncementService] Failed to create notifications:', (error as Error).message);
    }

    const announcement = await this.announcementRepository.findById(announcementId);
    if (!announcement) throw new Error('Announcement not found');
    return announcement;
  }

  async updateAnnouncement(
    id: number,
    data: { title?: string; content?: string },
  ): Promise<AnnouncementRow> {
    const announcement = await this.announcementRepository.findById(id);
    if (!announcement) {
      throw new Error('Announcement not found');
    }

    const payload: Record<string, unknown> = {};
    if (data.title !== undefined) {
      const trimmed = (data.title || '').trim();
      if (!trimmed) {
        throw new Error('Announcement title is required');
      }
      payload.title = trimmed;
    }
    if (data.content !== undefined) {
      const trimmed = (data.content || '').trim();
      if (!trimmed) {
        throw new Error('Announcement content is required');
      }
      payload.content = trimmed;
    }

    const updated = await this.announcementRepository.update(id, payload);
    if (!updated) {
      throw new Error('Failed to update announcement');
    }

    const refreshed = await this.announcementRepository.findById(id);
    if (!refreshed) throw new Error('Announcement not found');
    return refreshed;
  }

  async deleteAnnouncement(id: number): Promise<{ message: string }> {
    const announcement = await this.announcementRepository.findById(id);
    if (!announcement) {
      throw new Error('Announcement not found');
    }

    const deleted = await this.announcementRepository.delete(id);
    if (!deleted) {
      throw new Error('Failed to delete announcement');
    }

    return { message: 'Announcement deleted successfully' };
  }
}
