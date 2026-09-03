import type { MeetingRepository } from "../repositories/meetingRepository";
import type { MeetingNoteRepository } from "../repositories/meetingNoteRepository";
import type { MeetingReminderRepository } from "../repositories/meetingReminderRepository";
import type { MeetingAttendeeRepository } from "../repositories/meetingAttendeeRepository";
import type { MeetingAttachmentRepository } from "../repositories/meetingAttachmentRepository";
import type { NotificationRepository } from "../repositories/notificationRepository";
import type { UserRepository } from "../repositories/userRepository";
import type { MeetingRow, CreateMeetingData, UpdateMeetingData, MeetingNoteRow, CreateMeetingNoteData, MeetingReminderRow, CreateMeetingReminderData, MeetingAttendeeRow, UpdateAttendeeRsvpData, MeetingAttachmentRow, CreateMeetingAttachmentData } from "../types/Meeting";
import type { NotificationPreferenceService } from "./NotificationPreference.service";
import { sendToUser } from "../websocket/connection.registry";

export class MeetingService {
    constructor(
        private meetingRepository: MeetingRepository,
        private meetingNoteRepository: MeetingNoteRepository,
        private meetingReminderRepository: MeetingReminderRepository,
        private meetingAttendeeRepository: MeetingAttendeeRepository,
        private meetingAttachmentRepository: MeetingAttachmentRepository,
        private notificationRepository: NotificationRepository,
        private userRepository: UserRepository,
        private notificationPreferences?: NotificationPreferenceService | null,
    ) {}

    async getMeetings(companyId: number, filters: { search?: string; organizer_id?: number; department_id?: number; team_id?: number; status?: 'scheduled' | 'completed' | 'cancelled'; start_date?: string; end_date?: string } = {}): Promise<MeetingRow[]> {
        return this.meetingRepository.findAll(companyId, filters);
    }

    async getMeeting(id: number): Promise<MeetingRow> {
        const meeting = await this.meetingRepository.findById(id);
        if (!meeting) throw new Error('Meeting not found');
        return meeting;
    }

    async createMeeting(data: CreateMeetingData): Promise<MeetingRow> {
        const trimmedTitle = (data.title || '').trim();
        if (!trimmedTitle) throw new Error('Meeting title is required');

        const meetingId = await this.meetingRepository.create({
            ...data,
            title: trimmedTitle,
        });

        try {
            const organizer = await this.userRepository.findById(data.organizer_id);
            const organizerName = organizer
                ? `${organizer.first_name || ''} ${organizer.last_name || ''}`.trim()
                : 'Someone';

            const meeting = await this.meetingRepository.findById(meetingId);
            if (!meeting) throw new Error('Meeting not found');

            const startTime = new Date(`${meeting.meeting_date}T${meeting.start_time}`);
            const defaultRemindAt = new Date(startTime.getTime() - (meeting.remind_before_minutes || 15) * 60 * 1000);

            // Respect each participant's notification preferences.
            const inviteRecipients = this.notificationPreferences
                ? await this.notificationPreferences.filterEnabled('meetings', data.participants.map(Number))
                : data.participants.map(Number);

            for (const participantId of inviteRecipients) {
                if (Number(participantId) === Number(data.organizer_id)) continue;
                await this.notificationRepository.create({
                    user_id: participantId,
                    actor_id: data.organizer_id,
                    type: 'meeting_invite',
                    title: `Meeting: ${trimmedTitle}`,
                    message: `${organizerName} scheduled a meeting`,
                    data: { meetingId },
                });

                await this.meetingReminderRepository.create({
                    meeting_id: meetingId,
                    user_id: participantId,
                    remind_at: defaultRemindAt,
                });

                await this.meetingAttendeeRepository.createAttendee(meetingId, participantId, 'pending');

                sendToUser(participantId, {
                    type: 'notification',
                    data: {
                        type: 'meeting_invite',
                        title: `Meeting: ${trimmedTitle}`,
                        message: `${organizerName} scheduled a meeting`,
                        meetingId,
                    },
                });
            }

            await this.meetingAttendeeRepository.createAttendee(meetingId, data.organizer_id, 'accepted');

            await this.meetingReminderRepository.create({
                meeting_id: meetingId,
                user_id: data.organizer_id,
                remind_at: defaultRemindAt,
            });
        } catch (error) {
            console.error('[MeetingService] Failed to send notifications/reminders:', (error as Error).message);
        }

        const meeting = await this.meetingRepository.findById(meetingId);
        if (!meeting) throw new Error('Meeting not found');
        return meeting;
    }

    async updateMeeting(id: number, data: UpdateMeetingData): Promise<MeetingRow> {
        const meeting = await this.meetingRepository.findById(id);
        if (!meeting) throw new Error('Meeting not found');

        const payload: UpdateMeetingData = {};
        if (data.title !== undefined) {
            const trimmedTitle = (data.title || '').trim();
            if (!trimmedTitle) throw new Error('Meeting title is required');
            payload.title = trimmedTitle;
        }
        if (data.description !== undefined) payload.description = data.description;
        if (data.meeting_date !== undefined) payload.meeting_date = data.meeting_date;
        if (data.start_time !== undefined) payload.start_time = data.start_time;
        if (data.end_time !== undefined) payload.end_time = data.end_time;
        if (data.participants !== undefined) payload.participants = data.participants;
        if (data.status !== undefined) payload.status = data.status;
        if (data.recording_url !== undefined) payload.recording_url = data.recording_url;
        if (data.recording_status !== undefined) payload.recording_status = data.recording_status;
        if (data.calendar_event_id !== undefined) payload.calendar_event_id = data.calendar_event_id;
        if (data.calendar_provider !== undefined) payload.calendar_provider = data.calendar_provider;
        if (data.meeting_link !== undefined) payload.meeting_link = data.meeting_link;
        if (data.remind_before_minutes !== undefined) payload.remind_before_minutes = data.remind_before_minutes;
        if (data.recurrence_pattern !== undefined) payload.recurrence_pattern = data.recurrence_pattern;
        if (data.recurrence_interval !== undefined) payload.recurrence_interval = data.recurrence_interval;
        if (data.recurrence_end_date !== undefined) payload.recurrence_end_date = data.recurrence_end_date;
        if (data.recurrence_days !== undefined) payload.recurrence_days = data.recurrence_days;

        await this.meetingRepository.update(id, payload);
        const refreshed = await this.meetingRepository.findById(id);
        if (!refreshed) throw new Error('Meeting not found');
        return refreshed;
    }

    async cancelMeeting(id: number): Promise<{ message: string }> {
        const meeting = await this.meetingRepository.findById(id);
        if (!meeting) throw new Error('Meeting not found');

        await this.meetingRepository.update(id, { status: 'cancelled' });
        return { message: 'Meeting cancelled successfully' };
    }

    // Meeting notes
    async getMeetingNotes(meetingId: number): Promise<MeetingNoteRow[]> {
        return this.meetingNoteRepository.findAllByMeeting(meetingId);
    }

    async createMeetingNote(data: CreateMeetingNoteData): Promise<MeetingNoteRow> {
        const meeting = await this.meetingRepository.findById(data.meeting_id);
        if (!meeting) throw new Error('Meeting not found');

        const noteId = await this.meetingNoteRepository.create(data);
        const note = await this.meetingNoteRepository.findById(noteId);
        if (!note) throw new Error('Note not found');
        return note;
    }

    async updateMeetingNote(id: number, content: string): Promise<MeetingNoteRow> {
        const note = await this.meetingNoteRepository.findById(id);
        if (!note) throw new Error('Note not found');

        await this.meetingNoteRepository.update(id, content);
        const updated = await this.meetingNoteRepository.findById(id);
        if (!updated) throw new Error('Note not found');
        return updated;
    }

    async deleteMeetingNote(id: number): Promise<boolean> {
        return this.meetingNoteRepository.delete(id);
    }

    // Meeting reminders
    async getMeetingReminders(meetingId: number): Promise<MeetingReminderRow[]> {
        return this.meetingReminderRepository.findAllByMeeting(meetingId);
    }

    async setMeetingReminder(data: CreateMeetingReminderData): Promise<MeetingReminderRow> {
        const meeting = await this.meetingRepository.findById(data.meeting_id);
        if (!meeting) throw new Error('Meeting not found');

        const reminderId = await this.meetingReminderRepository.create(data);
        const reminder = await this.meetingReminderRepository.findById(reminderId);
        if (!reminder) throw new Error('Reminder not found');
        return reminder;
    }

    async deleteMeetingReminder(id: number, userId: number): Promise<boolean> {
        return this.meetingReminderRepository.delete(id, userId);
    }

    async processDueMeetingReminders(now: Date | string): Promise<void> {
        const due = await this.meetingReminderRepository.findDueReminders(now);
        if (due.length === 0) return;

        const ids: number[] = [];
        for (const reminder of due) {
            try {
                const meeting = await this.meetingRepository.findById(reminder.meeting_id);
                if (!meeting || meeting.status !== 'scheduled') continue;

                // Users who muted meetings get no reminder row — just consume
                // the due reminder so it is not retried forever.
                if (this.notificationPreferences &&
                    !(await this.notificationPreferences.isEnabled(reminder.user_id, 'meetings'))) {
                    ids.push(reminder.id);
                    continue;
                }

                await this.notificationRepository.create({
                    user_id: reminder.user_id,
                    actor_id: meeting.organizer_id,
                    type: 'meeting_reminder',
                    title: `Meeting reminder: ${meeting.title}`,
                    message: `Starts at ${meeting.start_time} on ${meeting.meeting_date}`,
                    data: { meetingId: meeting.id, remindAt: String(reminder.remind_at) },
                });

                sendToUser(reminder.user_id, {
                    type: 'meeting_reminder',
                    data: {
                        meetingId: meeting.id,
                        title: meeting.title,
                        startTime: meeting.start_time,
                        meetingDate: meeting.meeting_date,
                        remindAt: String(reminder.remind_at),
                    },
                    timestamp: new Date().toISOString(),
                });

                ids.push(reminder.id);
            } catch {
                // skip failed reminders
            }
        }

        if (ids.length > 0) {
            await this.meetingReminderRepository.markAsSent(ids);
        }
    }

    async updateRecordingStatus(id: number, recordingStatus: 'none' | 'recording' | 'processed' | 'failed', recordingUrl?: string): Promise<MeetingRow> {
        const meeting = await this.meetingRepository.findById(id);
        if (!meeting) throw new Error('Meeting not found');

        const payload: UpdateMeetingData = {
            recording_status: recordingStatus,
        };
        if (recordingUrl !== undefined) {
            payload.recording_url = recordingUrl;
        }

        await this.meetingRepository.update(id, payload);
        const refreshed = await this.meetingRepository.findById(id);
        if (!refreshed) throw new Error('Meeting not found');
        return refreshed;
    }

    async updateCalendarLink(id: number, calendarEventId: string, calendarProvider: 'google' | 'outlook' | 'ical'): Promise<MeetingRow> {
        const meeting = await this.meetingRepository.findById(id);
        if (!meeting) throw new Error('Meeting not found');

        await this.meetingRepository.update(id, {
            calendar_event_id: calendarEventId,
            calendar_provider: calendarProvider,
        });
        const refreshed = await this.meetingRepository.findById(id);
        if (!refreshed) throw new Error('Meeting not found');
        return refreshed;
    }

    async getMeetingAttendees(meetingId: number): Promise<MeetingAttendeeRow[]> {
        const meeting = await this.meetingRepository.findById(meetingId);
        if (!meeting) throw new Error('Meeting not found');
        return this.meetingAttendeeRepository.findAllByMeeting(meetingId);
    }

    async updateAttendeeRsvp(meetingId: number, userId: number, data: UpdateAttendeeRsvpData): Promise<MeetingAttendeeRow> {
        const meeting = await this.meetingRepository.findById(meetingId);
        if (!meeting) throw new Error('Meeting not found');

        const isParticipant = Array.isArray(meeting.participants) && (meeting.participants as number[]).includes(userId);
        if (!isParticipant && meeting.organizer_id !== userId) {
            throw new Error('You are not a participant of this meeting');
        }

        await this.meetingAttendeeRepository.updateRsvp(meetingId, userId, data);
        const attendee = await this.meetingAttendeeRepository.findByMeetingAndUser(meetingId, userId);
        if (!attendee) throw new Error('Attendee not found');
        return attendee;
    }

    async addMeetingAttendee(meetingId: number, userId: number): Promise<MeetingAttendeeRow> {
        const meeting = await this.meetingRepository.findById(meetingId);
        if (!meeting) throw new Error('Meeting not found');

        const isParticipant = (meeting.participants as number[]).includes(userId);
        if (!isParticipant && meeting.organizer_id !== userId) {
            throw new Error('User is not a participant of this meeting');
        }

        await this.meetingAttendeeRepository.createAttendee(meetingId, userId, 'pending');
        const attendee = await this.meetingAttendeeRepository.findByMeetingAndUser(meetingId, userId);
        if (!attendee) throw new Error('Attendee not found');
        return attendee;
    }

    async getMeetingAttachments(meetingId: number): Promise<MeetingAttachmentRow[]> {
        const meeting = await this.meetingRepository.findById(meetingId);
        if (!meeting) throw new Error('Meeting not found');
        return this.meetingAttachmentRepository.findAllByMeeting(meetingId);
    }

    async addMeetingAttachment(data: CreateMeetingAttachmentData): Promise<MeetingAttachmentRow> {
        const meeting = await this.meetingRepository.findById(data.meeting_id);
        if (!meeting) throw new Error('Meeting not found');

        const attachmentId = await this.meetingAttachmentRepository.create(data);
        const attachment = await this.meetingAttachmentRepository.findById(attachmentId);
        if (!attachment) throw new Error('Attachment not found');
        return attachment;
    }

    async deleteMeetingAttachment(id: number): Promise<boolean> {
        return this.meetingAttachmentRepository.delete(id);
    }
}
