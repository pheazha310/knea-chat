/**
 * AnnouncementService — business logic for announcements (SRS FR-24).
 *
 * Publishing is manager+ (enforced at the route layer). Since migration 022
 * an announcement targets a scope (company / department / team), can be
 * pinned, and can be scheduled to go live later (the server scheduler flips
 * it when the time arrives). Published announcements create an
 * `announcement` notification row for every recipient so the bell (and
 * Notifications view) surfaces the announcement immediately; read
 * confirmation is tracked in `announcement_reads`.
 */
import type { AnnouncementRepository } from '../repositories/announcementRepository';
import type { NotificationRepository } from '../repositories/notificationRepository';
import type { UserRepository } from '../repositories/userRepository';
import type { NotificationPreferenceService } from './NotificationPreference.service';
import { emitAnnouncementToUsers } from '../websocket/workspace.events';
import type {
  AnnouncementRow,
  AnnouncementScope,
  CreateAnnouncementData,
} from '../types';

const MANAGER_ROLES = ['super_admin', 'admin', 'manager'];
const SCOPES = new Set<AnnouncementScope>(['company', 'department', 'team']);

export class AnnouncementService {
  constructor(
    private announcementRepository: AnnouncementRepository,
    private notificationRepository: NotificationRepository,
    private userRepository: UserRepository,
    private notificationPreferences?: NotificationPreferenceService | null,
  ) {}

  private isManager(role: string): boolean {
    return MANAGER_ROLES.includes(role);
  }

  /** Department + role of a user (used to scope the announcement list). */
  private async getUserContext(userId: number): Promise<{ department_id: number | null; role: string }> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new Error('User not found');
    return { department_id: user.department_id ?? null, role: user.role };
  }

  /**
   * Validate the targeting fields: scope must be known, and department/team
   * targets must exist inside the same company.
   */
  private async validateTarget(
    scope: AnnouncementScope,
    departmentId: number | null | undefined,
    teamId: number | null | undefined,
    companyId: number,
  ): Promise<void> {
    if (!SCOPES.has(scope)) {
      throw new Error('scope must be company, department or team');
    }
    if (scope === 'department') {
      if (!departmentId) throw new Error('A department is required for department announcements');
      if (!(await this.announcementRepository.departmentExists(Number(departmentId), companyId))) {
        throw new Error('Department not found in this company');
      }
    } else if (scope === 'team') {
      if (!teamId) throw new Error('A team is required for team announcements');
      if (!(await this.announcementRepository.teamExists(Number(teamId), companyId))) {
        throw new Error('Team not found in this company');
      }
    }
  }

  /**
   * The announcement aimed at this user (or null when they can't see it).
   * Used by list + single-fetch endpoints; enriches with read progress.
   */
  private async getVisible(
    id: number,
    companyId: number,
    userId: number,
  ): Promise<AnnouncementRow | null> {
    const { department_id, role } = await this.getUserContext(userId);
    return this.announcementRepository.findByIdForUser(
      id,
      companyId,
      userId,
      department_id,
      this.isManager(role),
    );
  }

  async getAnnouncements(companyId: number, userId: number): Promise<AnnouncementRow[]> {
    const { department_id, role } = await this.getUserContext(userId);
    return this.announcementRepository.findAll(companyId, userId, department_id, this.isManager(role));
  }

  async getAnnouncement(id: number, companyId: number, userId: number): Promise<AnnouncementRow> {
    const announcement = await this.getVisible(id, companyId, userId);
    if (!announcement) {
      throw new Error('Announcement not found');
    }
    return announcement;
  }

  /**
   * Create + notify the audience. A future `scheduled_at` stores the
   * announcement unpublished (the scheduler publishes it later — no
   * notifications are sent yet); anything else goes live immediately.
   */
  async createAnnouncement(data: CreateAnnouncementData): Promise<AnnouncementRow> {
    const {
      company_id, title, content, created_by,
      scope = 'company', department_id, team_id,
      is_pinned = 0, scheduled_at = null,
    } = data;

    const trimmedTitle = (title || '').trim();
    const trimmedContent = (content || '').trim();
    if (!trimmedTitle) {
      throw new Error('Announcement title is required');
    }
    if (!trimmedContent) {
      throw new Error('Announcement content is required');
    }
    await this.validateTarget(scope, department_id, team_id, company_id);

    const now = new Date();
    const scheduled = scheduled_at ? new Date(String(scheduled_at)) : null;
    const isFuture = !!scheduled && !Number.isNaN(scheduled.getTime()) && scheduled.getTime() > now.getTime();
    const isPublished = isFuture ? 0 : 1;

    const announcementId = await this.announcementRepository.create({
      company_id,
      title: trimmedTitle,
      content: trimmedContent,
      created_by,
      scope,
      department_id: department_id ?? null,
      team_id: team_id ?? null,
      is_pinned: is_pinned ? 1 : 0,
      scheduled_at: isFuture ? scheduled : null,
      is_published: isPublished,
    });

    // Notify every recipient (except the publisher) so the announcement shows
    // up in the bell / Notifications view — but only for immediate publishes.
    // Scheduled announcements are notified by the scheduler when they go live.
    if (isPublished) {
      const announcement = await this.announcementRepository.findById(announcementId);
      if (announcement) {
        await this.notifyRecipients(announcement, created_by);
      }
    }

    const created = await this.getVisible(announcementId, company_id, created_by);
    if (!created) throw new Error('Announcement not found');
    return created;
  }

  async updateAnnouncement(
    id: number,
    data: {
      title?: string;
      content?: string;
      scope?: AnnouncementScope;
      department_id?: number | null;
      team_id?: number | null;
      is_pinned?: number | boolean;
      scheduled_at?: Date | string | null;
    },
    userId: number,
    companyId: number,
  ): Promise<AnnouncementRow> {
    const announcement = await this.announcementRepository.findById(id);
    if (!announcement) {
      throw new Error('Announcement not found');
    }
    if (Number(announcement.company_id) !== Number(companyId)) {
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

    const scope = (data.scope ?? announcement.scope ?? 'company') as AnnouncementScope;
    const departmentId = data.department_id !== undefined ? data.department_id : announcement.department_id;
    const teamId = data.team_id !== undefined ? data.team_id : announcement.team_id;
    await this.validateTarget(scope, departmentId ?? undefined, teamId ?? undefined, companyId);

    if (data.scope !== undefined) payload.scope = scope;
    if (data.department_id !== undefined) payload.department_id = departmentId ?? null;
    if (data.team_id !== undefined) payload.team_id = teamId ?? null;
    if (data.is_pinned !== undefined) payload.is_pinned = data.is_pinned ? 1 : 0;

    // Scheduling can only be set on an announcement that hasn't gone live yet
    // (a published announcement is already out there — its audience was
    // notified at publish time). Clearing the schedule on a draft publishes it
    // immediately.
    if (data.scheduled_at !== undefined && !announcement.is_published) {
      const scheduled = data.scheduled_at ? new Date(String(data.scheduled_at)) : null;
      const isFuture = !!scheduled && !Number.isNaN(scheduled.getTime()) && scheduled.getTime() > new Date().getTime();
      payload.scheduled_at = isFuture ? scheduled : null;
      if (!isFuture) {
        payload.is_published = 1;
        payload.published_at = new Date();
      }
    }

    const updated = await this.announcementRepository.update(id, payload);
    if (!updated) {
      throw new Error('Failed to update announcement');
    }

    const refreshed = await this.getVisible(id, companyId, userId);
    if (!refreshed) throw new Error('Announcement not found');

    // A draft that just went live reaches its audience now.
    if (!announcement.is_published && refreshed.is_published) {
      await this.notifyRecipients(refreshed, refreshed.created_by);
      const recipientIds = await this.announcementRepository.findRecipientUserIds(refreshed);
      emitAnnouncementToUsers(recipientIds, {
        type: 'announcement_created',
        data: { announcement: refreshed },
      }, userId);
      const snippet = refreshed.content.length > 120
        ? `${refreshed.content.slice(0, 120)}…`
        : refreshed.content;
      emitAnnouncementToUsers(recipientIds, {
        type: 'notification',
        data: {
          type: 'announcement',
          title: `Announcement: ${refreshed.title}`,
          message: snippet,
          announcementId: refreshed.id,
        },
      }, userId);
    }

    return refreshed;
  }

  async deleteAnnouncement(id: number, companyId: number): Promise<{ message: string }> {
    const announcement = await this.announcementRepository.findById(id);
    if (!announcement) {
      throw new Error('Announcement not found');
    }
    if (Number(announcement.company_id) !== Number(companyId)) {
      throw new Error('Announcement not found');
    }

    const deleted = await this.announcementRepository.delete(id);
    if (!deleted) {
      throw new Error('Failed to delete announcement');
    }

    return { message: 'Announcement deleted successfully' };
  }

  /** Recipient user ids of an announcement (for scoped live broadcasts). */
  async getRecipientIds(id: number): Promise<number[]> {
    const announcement = await this.announcementRepository.findById(id);
    if (!announcement) return [];
    return this.announcementRepository.findRecipientUserIds(announcement);
  }

  // -------------------------------------------------------------------------
  // Read confirmation
  // -------------------------------------------------------------------------

  /** Mark an announcement as read by `userId` (idempotent). */
  async markRead(id: number, userId: number, companyId: number): Promise<AnnouncementRow> {
    const announcement = await this.getVisible(id, companyId, userId);
    if (!announcement) {
      throw new Error('Announcement not found');
    }
    if (!announcement.is_published) {
      throw new Error('Announcement not found');
    }
    await this.announcementRepository.markRead(id, userId);
    const refreshed = await this.getVisible(id, companyId, userId);
    if (!refreshed) throw new Error('Announcement not found');
    return refreshed;
  }

  /** Who read an announcement + audience size (read-confirmation view). */
  async getReaders(id: number, companyId: number): Promise<{
    readers: Awaited<ReturnType<AnnouncementRepository['findReaders']>>;
    total_recipients: number;
  }> {
    const announcement = await this.announcementRepository.findById(id);
    if (!announcement) {
      throw new Error('Announcement not found');
    }
    if (Number(announcement.company_id) !== Number(companyId)) {
      throw new Error('Announcement not found');
    }
    const [readers, total] = await Promise.all([
      this.announcementRepository.findReaders(id),
      this.announcementRepository.countRecipients(announcement),
    ]);
    return { readers, total_recipients: total };
  }

  // -------------------------------------------------------------------------
  // Notifications + scheduling
  // -------------------------------------------------------------------------

  /** Create an `announcement` notification for every recipient (minus actor). */
  private async notifyRecipients(announcement: AnnouncementRow, actorId: number): Promise<void> {
    try {
      const memberIds = await this.announcementRepository.findRecipientUserIds(announcement);
      const recipients = this.notificationPreferences
        ? await this.notificationPreferences.filterEnabled('announcements', memberIds.map(Number))
        : memberIds.map(Number);
      const snippet = announcement.content.length > 120
        ? `${announcement.content.slice(0, 120)}…`
        : announcement.content;
      for (const userId of recipients) {
        if (Number(userId) === Number(actorId)) continue;
        await this.notificationRepository.create({
          user_id: userId,
          actor_id: actorId,
          type: 'announcement',
          title: announcement.title,
          message: snippet,
          data: { announcementId: announcement.id },
        });
      }
    } catch (error) {
      // Notification failures must never break announcement delivery.
      console.error('[AnnouncementService] Failed to create notifications:', (error as Error).message);
    }
  }

  /**
   * Scheduled-publish tick — polled by the server scheduler. Every scheduled
   * announcement whose time has come is flipped to published, its recipients
   * are notified, and connected clients get the live `announcement_created`
   * (list update) + `notification` (bell) events.
   */
  async processDueScheduledAnnouncements(now: Date = new Date()): Promise<AnnouncementRow[]> {
    const due = await this.announcementRepository.findDueScheduled(now);
    if (due.length === 0) return [];

    const published: AnnouncementRow[] = [];
    for (const announcement of due) {
      try {
        const ok = await this.announcementRepository.markPublished(announcement.id, now);
        if (!ok) continue; // someone else already published it
        const refreshed = await this.announcementRepository.findById(announcement.id);
        if (!refreshed) continue;

        await this.notifyRecipients(refreshed, refreshed.created_by);

        // Live updates: the list row for recipients + the bell notification.
        emitAnnouncementToUsers(
          await this.announcementRepository.findRecipientUserIds(refreshed),
          { type: 'announcement_created', data: { announcement: refreshed } },
        );
        const snippet = refreshed.content.length > 120
          ? `${refreshed.content.slice(0, 120)}…`
          : refreshed.content;
        emitAnnouncementToUsers(
          await this.announcementRepository.findRecipientUserIds(refreshed),
          {
            type: 'notification',
            data: {
              type: 'announcement',
              title: `Announcement: ${refreshed.title}`,
              message: snippet,
              announcementId: refreshed.id,
            },
          },
        );

        published.push(refreshed);
      } catch (error) {
        // Keep the scheduler moving; next tick will retry the rest.
        console.error('[AnnouncementService] Scheduled publish failed:', (error as Error).message);
      }
    }
    return published;
  }
}