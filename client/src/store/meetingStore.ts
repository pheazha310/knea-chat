import { create } from "zustand";
import { MeetingModel, UpdateMeetingInput, type Meeting, type CreateMeetingInput, type MeetingNote, type MeetingReminder, type MeetingAttendee, type MeetingAttachment } from "../models";
import { getErrorMessage } from "./utils";

const normalizeMeeting = (meeting: any): Meeting => ({
  ...meeting,
  meeting_date: meeting.meeting_date ? String(meeting.meeting_date).split(/[T ]/)[0] : meeting.meeting_date,
  participants: typeof meeting.participants === 'string' ? JSON.parse(meeting.participants) : meeting.participants || [],
});

interface MeetingState {
  meetings: Meeting[];
  loading: boolean;
  error: string | null;

  setMeetings: (meetings: Meeting[]) => void;
  addMeeting: (meeting: Meeting) => void;
  updateMeetingInList: (meeting: Meeting) => void;
  removeMeeting: (id: number) => void;

  notesByMeeting: Record<number, MeetingNote[]>;
  remindersByMeeting: Record<number, MeetingReminder[]>;
  attendeesByMeeting: Record<number, MeetingAttendee[]>;
  attachmentsByMeeting: Record<number, MeetingAttachment[]>;

  load: (filters?: { search?: string; organizer_id?: number; department_id?: number; team_id?: number; status?: string; start_date?: string; end_date?: string }) => Promise<void>;
  loadNotes: (meetingId: number) => Promise<void>;
  loadReminders: (meetingId: number) => Promise<void>;
  loadAttendees: (meetingId: number) => Promise<void>;
  loadAttachments: (meetingId: number) => Promise<void>;
  createMeeting: (data: CreateMeetingInput) => Promise<Meeting | undefined>;
  updateMeeting: (id: number, data: UpdateMeetingInput) => Promise<Meeting | undefined>;
  cancelMeeting: (id: number) => Promise<void>;
  createNote: (meetingId: number, content: string) => Promise<MeetingNote | undefined>;
  updateNote: (meetingId: number, noteId: number, content: string) => Promise<MeetingNote | undefined>;
  deleteNote: (meetingId: number, noteId: number) => Promise<void>;
  setReminder: (meetingId: number, remindAt: string) => Promise<MeetingReminder | undefined>;
  deleteReminder: (meetingId: number, reminderId: number) => Promise<void>;
  updateRecording: (id: number, recordingStatus: string, recordingUrl?: string) => Promise<Meeting | undefined>;
  updateCalendar: (id: number, calendarEventId: string, calendarProvider: string) => Promise<Meeting | undefined>;
  updateAttendeeRsvp: (meetingId: number, rsvpStatus: 'pending' | 'accepted' | 'declined' | 'maybe') => Promise<MeetingAttendee | undefined>;
  addAttendee: (meetingId: number) => Promise<MeetingAttendee | undefined>;
  addAttachment: (meetingId: number, file_name: string, file_url: string, file_type?: string, file_size?: number) => Promise<MeetingAttachment | undefined>;
  deleteAttachment: (meetingId: number, attachmentId: number) => Promise<void>;

  clear: () => void;
}

export const useMeetingStore = create<MeetingState>()((set, get) => ({
  meetings: [],
  loading: false,
  error: null,
  notesByMeeting: {},
  remindersByMeeting: {},
  attendeesByMeeting: {},
  attachmentsByMeeting: {},

  setMeetings: (meetings) => set({ meetings }),

  addMeeting: (meeting) =>
    set((state) => ({
      meetings: [meeting, ...state.meetings],
    })),

  updateMeetingInList: (meeting) =>
    set((state) => ({
      meetings: state.meetings.map((m) => (m.id === meeting.id ? meeting : m)),
    })),

  removeMeeting: (id) =>
    set((state) => ({
      meetings: state.meetings.filter((m) => m.id !== id),
    })),

  load: async (filters?: { search?: string; organizer_id?: number; department_id?: number; team_id?: number; status?: string; start_date?: string; end_date?: string }) => {
    set({ loading: true, error: null });
    try {
      const res = await MeetingModel.getAll(filters);
      const meetings = (res.data as any)?.data?.meetings || [];
      const parsed = meetings.map(normalizeMeeting);
      set({ meetings: parsed, loading: false });
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not load meetings'), loading: false });
    }
  },

  loadNotes: async (meetingId) => {
    try {
      const res = await MeetingModel.getNotes(meetingId);
      const notes = (res.data as any)?.data?.notes || [];
      set((state) => ({
        notesByMeeting: { ...state.notesByMeeting, [meetingId]: notes },
      }));
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not load notes') });
    }
  },

  loadReminders: async (meetingId) => {
    try {
      const res = await MeetingModel.getReminders(meetingId);
      const reminders = (res.data as any)?.data?.reminders || [];
      set((state) => ({
        remindersByMeeting: { ...state.remindersByMeeting, [meetingId]: reminders },
      }));
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not load reminders') });
    }
  },

  loadAttendees: async (meetingId) => {
    try {
      const res = await MeetingModel.getAttendees(meetingId);
      const attendees = (res.data as any)?.data?.attendees || [];
      set((state) => ({
        attendeesByMeeting: { ...state.attendeesByMeeting, [meetingId]: attendees },
      }));
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not load attendees') });
    }
  },

  loadAttachments: async (meetingId) => {
    try {
      const res = await MeetingModel.getAttachments(meetingId);
      const attachments = (res.data as any)?.data?.attachments || [];
      set((state) => ({
        attachmentsByMeeting: { ...state.attachmentsByMeeting, [meetingId]: attachments },
      }));
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not load attachments') });
    }
  },

  createMeeting: async (data) => {
    try {
      const res = await MeetingModel.create(data);
      const meeting = (res.data as any)?.data?.meeting;
      if (meeting) {
        get().addMeeting(normalizeMeeting(meeting));
      }
      return meeting;
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not schedule meeting') });
      throw err;
    }
  },

  updateMeeting: async (id, data) => {
    try {
      const res = await MeetingModel.update(id, data);
      const meeting = (res.data as any)?.data?.meeting;
      if (meeting) {
        get().updateMeetingInList(normalizeMeeting(meeting));
      }
      return meeting;
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not update meeting') });
      throw err;
    }
  },

  cancelMeeting: async (id: number) => {
    try {
      await MeetingModel.cancel(id);
      get().removeMeeting(id);
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not cancel meeting') });
      throw err;
    }
  },

  createNote: async (meetingId, content) => {
    try {
      const res = await MeetingModel.createNote(meetingId, { content });
      const note = (res.data as any)?.data?.note;
      if (note) {
        set((state) => ({
          notesByMeeting: {
            ...state.notesByMeeting,
            [meetingId]: [...(state.notesByMeeting[meetingId] || []), note],
          },
        }));
      }
      return note;
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not add note') });
      throw err;
    }
  },

  updateNote: async (meetingId, noteId, content) => {
    try {
      const res = await MeetingModel.updateNote(meetingId, noteId, { content });
      const note = (res.data as any)?.data?.note;
      if (note) {
        set((state) => ({
          notesByMeeting: {
            ...state.notesByMeeting,
            [meetingId]: (state.notesByMeeting[meetingId] || []).map((n) =>
              n.id === note.id ? note : n,
            ),
          },
        }));
      }
      return note;
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not update note') });
      throw err;
    }
  },

  deleteNote: async (meetingId, noteId) => {
    try {
      await MeetingModel.deleteNote(meetingId, noteId);
      set((state) => ({
        notesByMeeting: {
          ...state.notesByMeeting,
          [meetingId]: (state.notesByMeeting[meetingId] || []).filter((n) => n.id !== noteId),
        },
      }));
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not delete note') });
      throw err;
    }
  },

  setReminder: async (meetingId, remindAt) => {
    try {
      const res = await MeetingModel.setReminder(meetingId, { remind_at: remindAt });
      const reminder = (res.data as any)?.data?.reminder;
      if (reminder) {
        set((state) => ({
          remindersByMeeting: {
            ...state.remindersByMeeting,
            [meetingId]: [...(state.remindersByMeeting[meetingId] || []), reminder],
          },
        }));
      }
      return reminder;
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not set reminder') });
      throw err;
    }
  },

  deleteReminder: async (meetingId, reminderId) => {
    try {
      await MeetingModel.deleteReminder(meetingId, reminderId);
      set((state) => ({
        remindersByMeeting: {
          ...state.remindersByMeeting,
          [meetingId]: (state.remindersByMeeting[meetingId] || []).filter((r) => r.id !== reminderId),
        },
      }));
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not delete reminder') });
      throw err;
    }
  },

  updateRecording: async (id, recordingStatus, recordingUrl) => {
    try {
      const res = await MeetingModel.updateRecording(id, { recording_status: recordingStatus, recording_url: recordingUrl });
      const meeting = (res.data as any)?.data?.meeting;
      if (meeting) {
        get().updateMeetingInList(normalizeMeeting(meeting));
      }
      return meeting;
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not update recording') });
      throw err;
    }
  },

  updateCalendar: async (id, calendarEventId, calendarProvider) => {
    try {
      const res = await MeetingModel.updateCalendar(id, { calendar_event_id: calendarEventId, calendar_provider: calendarProvider });
      const meeting = (res.data as any)?.data?.meeting;
      if (meeting) {
        get().updateMeetingInList(normalizeMeeting(meeting));
      }
      return meeting;
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not update calendar link') });
      throw err;
    }
  },

  updateAttendeeRsvp: async (meetingId, rsvpStatus) => {
    try {
      const res = await MeetingModel.updateAttendeeRsvp(meetingId, rsvpStatus);
      const attendee = (res.data as any)?.data?.attendee;
      if (attendee) {
        set((state) => ({
          attendeesByMeeting: {
            ...state.attendeesByMeeting,
            [meetingId]: (state.attendeesByMeeting[meetingId] || []).map((a) =>
              a.id === attendee.id ? attendee : a,
            ),
          },
        }));
      }
      return attendee;
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not update RSVP') });
      throw err;
    }
  },

  addAttendee: async (meetingId) => {
    try {
      const res = await MeetingModel.addAttendee(meetingId);
      const attendee = (res.data as any)?.data?.attendee;
      if (attendee) {
        set((state) => ({
          attendeesByMeeting: {
            ...state.attendeesByMeeting,
            [meetingId]: [...(state.attendeesByMeeting[meetingId] || []), attendee],
          },
        }));
      }
      return attendee;
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not add attendee') });
      throw err;
    }
  },

  addAttachment: async (meetingId, file_name, file_url, file_type, file_size) => {
    try {
      const res = await MeetingModel.addAttachment(meetingId, { file_name, file_url, file_type, file_size });
      const attachment = (res.data as any)?.data?.attachment;
      if (attachment) {
        set((state) => ({
          attachmentsByMeeting: {
            ...state.attachmentsByMeeting,
            [meetingId]: [...(state.attachmentsByMeeting[meetingId] || []), attachment],
          },
        }));
      }
      return attachment;
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not add attachment') });
      throw err;
    }
  },

  deleteAttachment: async (meetingId, attachmentId) => {
    try {
      await MeetingModel.deleteAttachment(meetingId, attachmentId);
      set((state) => ({
        attachmentsByMeeting: {
          ...state.attachmentsByMeeting,
          [meetingId]: (state.attachmentsByMeeting[meetingId] || []).filter((a) => a.id !== attachmentId),
        },
      }));
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not delete attachment') });
      throw err;
    }
  },

  clear: () => set({ meetings: [], loading: false, error: null, notesByMeeting: {}, remindersByMeeting: {}, attendeesByMeeting: {}, attachmentsByMeeting: {} }),
}));
