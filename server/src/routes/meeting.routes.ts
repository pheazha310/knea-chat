import { Router } from 'express';
import { MeetingController } from '../controllers/meeting.controller';
import { AuthMiddleware } from '../middleware/auth.middleware';

export const createMeetingRouter = (
    meetingController: MeetingController,
    auth: AuthMiddleware,
): Router => {
    const router = Router();

    router.get('/', auth.authenticate, meetingController.list);
    router.get('/:id', auth.authenticate, meetingController.getById);
    router.get('/:id/ics', auth.authenticate, meetingController.icsExport);
    router.post('/', auth.authenticate, meetingController.create);
    router.patch('/:id', auth.authenticate, auth.authorizeAtLeast('manager'), meetingController.update);
    router.delete('/:id', auth.authenticate, auth.authorizeAtLeast('manager'), meetingController.cancel);

    // Meeting notes
    router.get('/:id/notes', auth.authenticate, meetingController.listNotes);
    router.post('/:id/notes', auth.authenticate, meetingController.createNote);
    router.patch('/:id/notes/:noteId', auth.authenticate, meetingController.updateNote);
    router.delete('/:id/notes/:noteId', auth.authenticate, meetingController.deleteNote);

    // Meeting reminders
    router.get('/:id/reminders', auth.authenticate, meetingController.listReminders);
    router.post('/:id/reminders', auth.authenticate, meetingController.setReminder);
    router.delete('/:id/reminders/:reminderId', auth.authenticate, meetingController.deleteReminder);

    // Recording
    router.patch('/:id/recording', auth.authenticate, auth.authorizeAtLeast('manager'), meetingController.updateRecording);

    // Calendar
    router.patch('/:id/calendar', auth.authenticate, auth.authorizeAtLeast('manager'), meetingController.updateCalendar);

    // Attendees / RSVP
    router.get('/:id/attendees', auth.authenticate, meetingController.listAttendees);
    router.post('/:id/attendees', auth.authenticate, meetingController.addAttendee);
    router.patch('/:id/attendees/rsvp', auth.authenticate, meetingController.updateAttendeeRsvp);

    // Attachments
    router.get('/:id/attachments', auth.authenticate, meetingController.listAttachments);
    router.post('/:id/attachments', auth.authenticate, meetingController.addAttachment);
    router.delete('/:id/attachments/:attachmentId', auth.authenticate, meetingController.deleteAttachment);

    return router;
}
