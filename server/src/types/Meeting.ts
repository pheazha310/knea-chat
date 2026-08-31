export interface MeetingRow {
    id: number;
    company_id: number;
    title: string;
    description: string | null;
    meeting_date: string;
    start_time: string;
    end_time: string;
    organizer_id: number;
    participants: string | number[];
    status: 'scheduled' | 'completed' | 'cancelled';
    created_at: Date | string;
    updated_at: Date | string;
    organizer_first_name?: string;
    organizer_last_name?: string;
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
}

export interface CreateMeetingData {
    company_id: number;
    title: string;
    description?: string;
    meeting_date: string;
    start_time: string;
    end_time: string;
    organizer_id: number;
    participants: number[];
    remind_before_minutes?: number;
    meeting_link?: string;
    recurrence_pattern?: 'none' | 'daily' | 'weekly' | 'monthly';
    recurrence_interval?: number;
    recurrence_end_date?: string;
    recurrence_days?: number[];
}

export interface UpdateMeetingData {
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

export interface MeetingAttendeeRow {
    id: number;
    meeting_id: number;
    user_id: number;
    rsvp_status: 'pending' | 'accepted' | 'declined' | 'maybe';
    responded_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
    user_first_name?: string;
    user_last_name?: string;
    user_email?: string;
}

export interface MeetingNoteRow {
    id: number;
    meeting_id: number;
    user_id: number;
    content: string;
    created_at: Date | string;
    updated_at: Date | string;
    user_first_name?: string;
    user_last_name?: string;
}

export interface CreateMeetingNoteData {
    meeting_id: number;
    user_id: number;
    content: string;
}

export interface MeetingReminderRow {
    id: number;
    meeting_id: number;
    user_id: number;
    remind_at: Date | string;
    is_sent: number;
    created_at: Date | string;
}

export interface CreateMeetingReminderData {
    meeting_id: number;
    user_id: number;
    remind_at: Date | string;
}

export interface MeetingAttachmentRow {
    id: number;
    meeting_id: number;
    uploaded_by: number;
    file_name: string;
    file_url: string;
    file_type?: string;
    file_size?: number;
    created_at: Date | string;
    updated_at: Date | string;
    uploader_first_name?: string;
    uploader_last_name?: string;
}

export interface CreateMeetingAttachmentData {
    meeting_id: number;
    uploaded_by: number;
    file_name: string;
    file_url: string;
    file_type?: string;
    file_size?: number;
}

export interface UpdateAttendeeRsvpData {
    rsvp_status: 'pending' | 'accepted' | 'declined' | 'maybe';
}
