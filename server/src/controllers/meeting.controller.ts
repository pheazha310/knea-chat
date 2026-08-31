import type { NextFunction, Request, Response } from "express";
import type { MeetingService } from "../services/Meeting.service";
import { emitAnnouncementEvent } from "../websocket/workspace.events";

export class MeetingController {
    constructor(private meetingService: MeetingService) {}

    list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { search, organizer_id, department_id, team_id, status, start_date, end_date } = req.query;
            const meetings = await this.meetingService.getMeetings(req.user!.companyId, {
                search: typeof search === 'string' ? search : undefined,
                organizer_id: organizer_id ? Number(organizer_id) : undefined,
                department_id: department_id ? Number(department_id) : undefined,
                team_id: team_id ? Number(team_id) : undefined,
                status: typeof status === 'string' ? status as 'scheduled' | 'completed' | 'cancelled' : undefined,
                start_date: typeof start_date === 'string' ? start_date : undefined,
                end_date: typeof end_date === 'string' ? end_date : undefined,
            });
            res.status(200).json({success: true, message: 'Meetings retrieved successfully', data: { meetings }});
        } catch (error) {
            next(error);
        }
    };

    getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try{
            const meeting = await this.meetingService.getMeeting(Number(req.params.id));
            res.status(200).json({ success: true, message: 'Meeting retrieved', data: { meeting }});
        } catch (error) {
            next(error);
        }
    };

    create = async (req: Request, res: Response): Promise<void> => {
        try {
            const { title, description, meeting_date, start_time, end_time, participants, remind_before_minutes, meeting_link, recurrence_pattern, recurrence_interval, recurrence_end_date, recurrence_days } = req.body;
            if (!title || !meeting_date || !start_time || !end_time) {
                res.status(400).json({
                    success: false,
                    message: 'Title, date, start time, and end time are required',
                    errors: {},
                });
                return;
            }

            if (!Array.isArray(participants)) {
                res.status(400).json({
                    success: false,
                    message: 'Participants must be an array',
                    errors: {},
                });
                return;
            }

            const meeting = await this.meetingService.createMeeting({
                company_id: req.user!.companyId,
                title,
                description,
                meeting_date,
                start_time,
                end_time,
                organizer_id: req.user!.id,
                participants,
                remind_before_minutes,
                meeting_link,
                recurrence_pattern: recurrence_pattern || 'none',
                recurrence_interval: recurrence_interval || 1,
                recurrence_end_date,
                recurrence_days,
            });

            emitAnnouncementEvent(req.user!.companyId, {
                type: 'meeting_created',
                data: { meeting },
            }, req.user!.id);

            res.status(201).json({success: true, message: 'Meeting created successfully', data: { meeting }});
        } catch (error) {
            res.status(400).json({success: false, message: (error as Error).message, errors: {} });
        } 
    };

    update = async (req: Request, res: Response): Promise<void> => {
        try {
            const meetingId = Number(req.params.id);
            const { title, description, meeting_date, start_time, end_time, participants, status, recording_url, recording_status, calendar_event_id, calendar_provider, meeting_link, remind_before_minutes, recurrence_pattern, recurrence_interval, recurrence_end_date, recurrence_days } = req.body;

            const meeting = await this.meetingService.updateMeeting(meetingId, {
                title,
                description,
                meeting_date,
                start_time,
                end_time,
                participants,
                status,
                recording_url,
                recording_status,
                calendar_event_id,
                calendar_provider,
                meeting_link,
                remind_before_minutes,
                recurrence_pattern,
                recurrence_interval,
                recurrence_end_date,
                recurrence_days,
            });

            emitAnnouncementEvent(req.user!.companyId, {
                type: 'meeting_updated',
                data: { meeting },
            }, req.user!.id);

            res.status(200).json({
                success: true, message: 'Meeting updated successfully',
                data: { meeting }, 
            });
        } catch (error) {
            res.status(400).json({ success: false, message: (error as Error).message, errors: {}})
        }
    };

    cancel = async (req: Request, res: Response): Promise<void> => {
        try{
            const meetingId = Number(req.params.id);
            const result = await this.meetingService.cancelMeeting(meetingId);

            const meeting = await this.meetingService.getMeeting(meetingId);

            emitAnnouncementEvent(req.user!.companyId, {
                type: 'meeting_cancelled',
                data: { meeting },
            }, req.user!.id);

            res.status(200).json({ success: true, message: result.message, data: { meeting }});
        } catch (error) {
            res.status(400).json({ success: false, message: (error as Error).message, errors: {}})
        }
    }

    listNotes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const notes = await this.meetingService.getMeetingNotes(Number(req.params.id));
            res.status(200).json({ success: true, data: { notes } });
        } catch (error) {
            next(error);
        }
    };

    createNote = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { content } = req.body;
            if (!content || !content.trim()) {
                res.status(400).json({ success: false, message: 'Note content is required', errors: {} });
                return;
            }
            const note = await this.meetingService.createMeetingNote({
                meeting_id: Number(req.params.id),
                user_id: req.user!.id,
                content: content.trim(),
            });
            emitAnnouncementEvent(req.user!.companyId, {
                type: 'meeting_note_added',
                data: { note, meetingId: Number(req.params.id) },
            }, req.user!.id);
            res.status(201).json({ success: true, message: 'Note added', data: { note } });
        } catch (error) {
            next(error);
        }
    };

    updateNote = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const note = await this.meetingService.updateMeetingNote(Number(req.params.noteId), req.body.content);
            emitAnnouncementEvent(req.user!.companyId, {
                type: 'meeting_note_updated',
                data: { note, meetingId: Number(req.params.id) },
            }, req.user!.id);
            res.status(200).json({ success: true, message: 'Note updated', data: { note } });
        } catch (error) {
            next(error);
        }
    };

    deleteNote = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const deleted = await this.meetingService.deleteMeetingNote(Number(req.params.noteId));
            if (!deleted) {
                res.status(404).json({ success: false, message: 'Note not found', errors: {} });
                return;
            }
            emitAnnouncementEvent(req.user!.companyId, {
                type: 'meeting_note_deleted',
                data: { noteId: Number(req.params.noteId), meetingId: Number(req.params.id) },
            }, req.user!.id);
            res.status(200).json({ success: true, message: 'Note deleted' });
        } catch (error) {
            next(error);
        }
    };

    // Meeting reminders
    listReminders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const reminders = await this.meetingService.getMeetingReminders(Number(req.params.id));
            res.status(200).json({ success: true, data: { reminders } });
        } catch (error) {
            next(error);
        }
    };

    setReminder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { remind_at } = req.body;
            if (!remind_at) {
                res.status(400).json({ success: false, message: 'remind_at is required', errors: {} });
                return;
            }
            const reminder = await this.meetingService.setMeetingReminder({
                meeting_id: Number(req.params.id),
                user_id: req.user!.id,
                remind_at,
            });
            emitAnnouncementEvent(req.user!.companyId, {
                type: 'meeting_reminder_set',
                data: { reminder, meetingId: Number(req.params.id) },
            }, req.user!.id);
            res.status(201).json({ success: true, message: 'Reminder set', data: { reminder } });
        } catch (error) {
            next(error);
        }
    };

    deleteReminder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const deleted = await this.meetingService.deleteMeetingReminder(Number(req.params.reminderId), req.user!.id);
            if (!deleted) {
                res.status(404).json({ success: false, message: 'Reminder not found', errors: {} });
                return;
            }
            emitAnnouncementEvent(req.user!.companyId, {
                type: 'meeting_reminder_deleted',
                data: { reminderId: Number(req.params.reminderId), meetingId: Number(req.params.id) },
            }, req.user!.id);
            res.status(200).json({ success: true, message: 'Reminder deleted' });
        } catch (error) {
            next(error);
        }
    };

    // Recording
    updateRecording = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { recording_status, recording_url } = req.body;
            const meeting = await this.meetingService.updateRecordingStatus(
                Number(req.params.id),
                recording_status,
                recording_url,
            );
            emitAnnouncementEvent(req.user!.companyId, {
                type: 'meeting_recording_updated',
                data: { meeting },
            }, req.user!.id);
            res.status(200).json({ success: true, message: 'Recording updated', data: { meeting } });
        } catch (error) {
            next(error);
        }
    };

    // Calendar
    updateCalendar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { calendar_event_id, calendar_provider } = req.body;
            const meeting = await this.meetingService.updateCalendarLink(
                Number(req.params.id),
                calendar_event_id,
                calendar_provider,
            );
            emitAnnouncementEvent(req.user!.companyId, {
                type: 'meeting_updated',
                data: { meeting },
            }, req.user!.id);
            res.status(200).json({ success: true, message: 'Calendar link updated', data: { meeting } });
        } catch (error) {
            next(error);
        }
    };

    // Meeting attendees / RSVP
    listAttendees = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const attendees = await this.meetingService.getMeetingAttendees(Number(req.params.id));
            res.status(200).json({ success: true, data: { attendees } });
        } catch (error) {
            next(error);
        }
    };

    updateAttendeeRsvp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const attendee = await this.meetingService.updateAttendeeRsvp(
                Number(req.params.id),
                req.user!.id,
                req.body,
            );
            emitAnnouncementEvent(req.user!.companyId, {
                type: 'meeting_attendee_updated',
                data: { attendee, meetingId: Number(req.params.id) },
            }, req.user!.id);
            res.status(200).json({ success: true, message: 'RSVP updated', data: { attendee } });
        } catch (error) {
            next(error);
        }
    };

    addAttendee = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const attendee = await this.meetingService.addMeetingAttendee(
                Number(req.params.id),
                req.user!.id,
            );
            emitAnnouncementEvent(req.user!.companyId, {
                type: 'meeting_attendee_added',
                data: { attendee, meetingId: Number(req.params.id) },
            }, req.user!.id);
            res.status(201).json({ success: true, message: 'Attendee added', data: { attendee } });
        } catch (error) {
            next(error);
        }
    };

    // Meeting attachments
    listAttachments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const attachments = await this.meetingService.getMeetingAttachments(Number(req.params.id));
            res.status(200).json({ success: true, data: { attachments } });
        } catch (error) {
            next(error);
        }
    };

    addAttachment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { file_name, file_url, file_type, file_size } = req.body;
            const attachment = await this.meetingService.addMeetingAttachment({
                meeting_id: Number(req.params.id),
                uploaded_by: req.user!.id,
                file_name,
                file_url,
                file_type,
                file_size,
            });
            emitAnnouncementEvent(req.user!.companyId, {
                type: 'meeting_attachment_added',
                data: { attachment, meetingId: Number(req.params.id) },
            }, req.user!.id);
            res.status(201).json({ success: true, message: 'Attachment added', data: { attachment } });
        } catch (error) {
            next(error);
        }
    };

    deleteAttachment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const deleted = await this.meetingService.deleteMeetingAttachment(Number(req.params.attachmentId));
            if (!deleted) {
                res.status(404).json({ success: false, message: 'Attachment not found', errors: {} });
                return;
            }
            emitAnnouncementEvent(req.user!.companyId, {
                type: 'meeting_attachment_deleted',
                data: { attachmentId: Number(req.params.attachmentId), meetingId: Number(req.params.id) },
            }, req.user!.id);
            res.status(200).json({ success: true, message: 'Attachment deleted' });
        } catch (error) {
            next(error);
        }
    };

    icsExport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const meeting = await this.meetingService.getMeeting(Number(req.params.id));
            const start = new Date(`${meeting.meeting_date}T${meeting.start_time}`);
            const end = new Date(`${meeting.meeting_date}T${meeting.end_time}`);
            const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const uid = `meeting-${meeting.id}@kneachat`;
            const lines = [
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'PRODID:-//KneaChat//EN',
                'METHOD:PUBLISH',
                `UID:${uid}`,
                `DTSTAMP:${fmt(new Date())}`,
                `DTSTART:${fmt(start)}`,
                `DTEND:${fmt(end)}`,
                `SUMMARY:${meeting.title}`,
                meeting.description ? `DESCRIPTION:${meeting.description.replace(/\n/g, '\\n')}` : undefined,
                meeting.meeting_link ? `URL:${meeting.meeting_link}` : undefined,
                'END:VCALENDAR',
            ].filter(Boolean).join('\r\n');
            res.setHeader('Content-Type', 'text/calendar;charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="meeting-${meeting.id}.ics"`);
            res.status(200).send(lines);
        } catch (error) {
            next(error);
        }
    };
}
