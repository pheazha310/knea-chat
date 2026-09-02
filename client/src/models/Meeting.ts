import api from "../services/api";
import { API_BASE_URL } from "../services/api";

export interface Meeting {
    id: number;
    company_id: number;
    title: string;
    description: string | null;
    meeting_date: string;
    start_time: string;
    end_time: string;
    organizer_id: number;
    organizer_first_name?: string;
    organizer_last_name?: string;
    participants: number[];
    status: 'scheduled' | 'completed' | 'cancelled';
    created_at?: string;
    updated_at?: string;
    recording_url?: string | null;
    recording_status?: 'none' | 'recording' | 'processed' | 'failed';
    calendar_event_id?: string | null;
    calendar_provider?: 'google' | 'outlook' | 'ical' | null;
    meeting_link?: string | null;
    remind_before_minutes?: number;
    recurrence_pattern?: 'none' | 'daily' | 'weekly' | 'monthly';
    recurrence_interval?: number;
    recurrence_end_date?: string | null;
    recurrence_days?: number[] | null;
    attendees?: MeetingAttendee[];
}

export interface MeetingNote {
    id: number;
    meeting_id: number;
    user_id: number;
    content: string;
    created_at?: string;
    updated_at?: string;
    user_first_name?: string;
    user_last_name?: string;
}

export interface MeetingAttachment {
    id: number;
    meeting_id: number;
    uploaded_by: number;
    file_name: string;
    file_url: string;
    file_type?: string;
    file_size?: number;
    created_at?: string;
    updated_at?: string;
    uploader_first_name?: string;
    uploader_last_name?: string;
}

export interface CreateMeetingAttachmentInput {
    file_name: string;
    file_url: string;
    file_type?: string;
    file_size?: number;
}

export interface MeetingAttendee {
    id: number;
    meeting_id: number;
    user_id: number;
    rsvp_status: 'pending' | 'accepted' | 'declined' | 'maybe';
    responded_at?: string | null;
    created_at?: string;
    updated_at?: string;
    user_first_name?: string;
    user_last_name?: string;
    user_email?: string;
}

export interface MeetingReminder {
    id: number;
    meeting_id: number;
    user_id: number;
    remind_at: string;
    is_sent: number;
    created_at?: string;
}

export interface CreateMeetingInput {
    title: string;
    description?: string;
    meeting_date: string;
    start_time: string;
    end_time: string;
    participants: number[];
    remind_before_minutes?: number;
    meeting_link?: string;
    recurrence_pattern?: 'none' | 'daily' | 'weekly' | 'monthly';
    recurrence_interval?: number;
    recurrence_end_date?: string;
    recurrence_days?: number[];
}

export interface UpdateMeetingInput {
    title?: string;
    description?: string;
    meeting_date?: string;
    start_time?: string;
    end_time?: string;
    participants?: number[];
    status?: 'scheduled' | 'completed' | 'cancelled';
    recording_url?: string;
    recording_status?: 'none' | 'recording' | 'processed' | 'failed';
    calendar_event_id?: string;
    calendar_provider?: 'google' | 'outlook' | 'ical';
    meeting_link?: string;
    remind_before_minutes?: number;
    recurrence_pattern?: 'none' | 'daily' | 'weekly' | 'monthly';
    recurrence_interval?: number;
    recurrence_end_date?: string;
    recurrence_days?: number[];
}

export interface CreateMeetingNoteInput {
    content: string;
}

export interface CreateMeetingReminderInput {
    remind_at: string;
}

export interface MeetingFilters {
    search?: string;
    organizer_id?: number;
    department_id?: number;
    team_id?: number;
    status?: 'scheduled' | 'completed' | 'cancelled' | string;
    start_date?: string;
    end_date?: string;
}

export const MeetingModel = {
    getAll: (filters?: MeetingFilters) => {
        const params = new URLSearchParams();
        if (filters?.search) params.set('search', filters.search);
        if (filters?.organizer_id) params.set('organizer_id', String(filters.organizer_id));
        if (filters?.department_id) params.set('department_id', String(filters.department_id));
        if (filters?.team_id) params.set('team_id', String(filters.team_id));
        if (filters?.status) params.set('status', filters.status);
        if (filters?.start_date) params.set('start_date', filters.start_date);
        if (filters?.end_date) params.set('end_date', filters.end_date);
        const qs = params.toString();
        return api.get<{ success: boolean; data: { meetings: Meeting[] } }>(`/meetings${qs ? `?${qs}` : ''}`);
    },
    get: (id: number) => 
        api.get<{ success: boolean; data: { meeting: Meeting } }>(`/meetings/${id}`),
    create: (data: CreateMeetingInput) =>
        api.post<{ success: boolean; data: { meeting: Meeting } }>('/meetings', data),
    update: (id: number, data: UpdateMeetingInput) =>
        api.patch<{ success: boolean; data: { meeting: Meeting } }>(`/meetings/${id}`, data),
    cancel: (id: number) => 
        api.delete<{ success: boolean; message: string; data: { meeting: Meeting } }>(`/meetings/${id}`),
    getNotes: (meetingId: number) =>
        api.get<{ success: boolean; data: { notes: MeetingNote[] } }>(`/meetings/${meetingId}/notes`),
    createNote: (meetingId: number, data: CreateMeetingNoteInput) =>
        api.post<{ success: boolean; data: { note: MeetingNote } }>(`/meetings/${meetingId}/notes`, data),
    updateNote: (meetingId: number, noteId: number, data: { content: string }) =>
        api.patch<{ success: boolean; data: { note: MeetingNote } }>(`/meetings/${meetingId}/notes/${noteId}`, data),
    deleteNote: (meetingId: number, noteId: number) =>
        api.delete<{ success: boolean; message: string }>(`/meetings/${meetingId}/notes/${noteId}`),
    getReminders: (meetingId: number) =>
        api.get<{ success: boolean; data: { reminders: MeetingReminder[] } }>(`/meetings/${meetingId}/reminders`),
    setReminder: (meetingId: number, data: CreateMeetingReminderInput) =>
        api.post<{ success: boolean; data: { reminder: MeetingReminder } }>(`/meetings/${meetingId}/reminders`, data),
    deleteReminder: (meetingId: number, reminderId: number) =>
        api.delete<{ success: boolean; message: string }>(`/meetings/${meetingId}/reminders/${reminderId}`),
    updateRecording: (id: number, data: { recording_status: string; recording_url?: string }) =>
        api.patch<{ success: boolean; data: { meeting: Meeting } }>(`/meetings/${id}/recording`, data),
    updateCalendar: (id: number, data: { calendar_event_id: string; calendar_provider: string }) =>
        api.patch<{ success: boolean; data: { meeting: Meeting } }>(`/meetings/${id}/calendar`, data),
    exportIcs: async (id: number) => {
        const token = localStorage.getItem('kneachat_token');
        const res = await fetch(`${API_BASE_URL}/meetings/${id}/ics`, {
            headers: { Authorization: `Bearer ${token || ''}` },
        });
        if (!res.ok) throw new Error('Failed to export ICS');
        return res.blob();
    },
    getAttendees: (meetingId: number) =>
        api.get<{ success: boolean; data: { attendees: MeetingAttendee[] } }>(`/meetings/${meetingId}/attendees`),
    updateAttendeeRsvp: (meetingId: number, rsvpStatus: 'pending' | 'accepted' | 'declined' | 'maybe') =>
        api.patch<{ success: boolean; data: { attendee: MeetingAttendee } }>(`/meetings/${meetingId}/attendees/rsvp`, { rsvp_status: rsvpStatus }),
    addAttendee: (meetingId: number) =>
        api.post<{ success: boolean; data: { attendee: MeetingAttendee } }>(`/meetings/${meetingId}/attendees`, {}),
    getAttachments: (meetingId: number) =>
        api.get<{ success: boolean; data: { attachments: MeetingAttachment[] } }>(`/meetings/${meetingId}/attachments`),
    addAttachment: (meetingId: number, data: CreateMeetingAttachmentInput) =>
        api.post<{ success: boolean; data: { attachment: MeetingAttachment } }>(`/meetings/${meetingId}/attachments`, data),
    deleteAttachment: (meetingId: number, attachmentId: number) =>
        api.delete<{ success: boolean; message: string }>(`/meetings/${meetingId}/attachments/${attachmentId}`),
}
