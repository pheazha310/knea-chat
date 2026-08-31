import type { Db, ResultSetHeader } from "../database/connection";
import type { MeetingAttendeeRow, UpdateAttendeeRsvpData } from "../types/Meeting";

export class MeetingAttendeeRepository {
    constructor(private db: Db) {}

    async findAllByMeeting(meetingId: number): Promise<MeetingAttendeeRow[]> {
        return this.db.query<MeetingAttendeeRow[]>(
            `SELECT a.*, u.first_name AS user_first_name, u.last_name AS user_last_name, u.email AS user_email
            FROM meeting_attendees a
            LEFT JOIN users u ON a.user_id = u.id
            WHERE a.meeting_id = ?
            ORDER BY a.rsvp_status ASC, u.first_name ASC`,
            [meetingId],
        );
    }

    async findByMeetingAndUser(meetingId: number, userId: number): Promise<MeetingAttendeeRow | null> {
        const rows = await this.db.query<MeetingAttendeeRow[]>(
            `SELECT a.*, u.first_name AS user_first_name, u.last_name AS user_last_name, u.email AS user_email
            FROM meeting_attendees a
            LEFT JOIN users u ON a.user_id = u.id
            WHERE a.meeting_id = ? AND a.user_id = ?`,
            [meetingId, userId],
        );
        return rows[0] || null;
    }

    async createAttendee(meetingId: number, userId: number, rsvpStatus: 'pending' | 'accepted' | 'declined' | 'maybe' = 'pending'): Promise<number> {
        const result = await this.db.query<ResultSetHeader>(
            `INSERT INTO meeting_attendees (meeting_id, user_id, rsvp_status)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE rsvp_status = VALUES(rsvp_status), updated_at = CURRENT_TIMESTAMP`,
            [meetingId, userId, rsvpStatus],
        );
        return result.insertId;
    }

    async updateRsvp(meetingId: number, userId: number, data: UpdateAttendeeRsvpData): Promise<boolean> {
        const result = await this.db.query<ResultSetHeader>(
            `INSERT INTO meeting_attendees (meeting_id, user_id, rsvp_status, responded_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE rsvp_status = VALUES(rsvp_status), responded_at = CURRENT_TIMESTAMP`,
            [meetingId, userId, data.rsvp_status],
        );
        return result.affectedRows > 0;
    }

    async delete(meetingId: number, userId: number): Promise<boolean> {
        const result = await this.db.query<ResultSetHeader>(
            `DELETE FROM meeting_attendees WHERE meeting_id = ? AND user_id = ?`,
            [meetingId, userId],
        );
        return result.affectedRows > 0;
    }

    async deleteByMeeting(meetingId: number): Promise<boolean> {
        const result = await this.db.query<ResultSetHeader>(
            `DELETE FROM meeting_attendees WHERE meeting_id = ?`,
            [meetingId],
        );
        return result.affectedRows > 0;
    }

    async countByMeetingAndStatus(meetingId: number, status: 'pending' | 'accepted' | 'declined' | 'maybe'): Promise<number> {
        const [row] = await this.db.query<Array<{ count: number }>>(
            `SELECT COUNT(*) as count FROM meeting_attendees WHERE meeting_id = ? AND rsvp_status = ?`,
            [meetingId, status],
        );
        return parseInt(String(row.count));
    }
}
