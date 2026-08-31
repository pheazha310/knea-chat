import type { Db, ResultSetHeader } from "../database/connection";
import type { MeetingReminderRow, CreateMeetingReminderData } from "../types/Meeting";

export class MeetingReminderRepository {
    constructor(private db: Db) {}

    async findAllByMeeting(meetingId: number): Promise<MeetingReminderRow[]> {
        return this.db.query<MeetingReminderRow[]>(
            `SELECT * FROM meeting_reminders
            WHERE meeting_id = ?
            ORDER BY remind_at ASC`,
            [meetingId],
        );
    }

    async findById(id: number): Promise<MeetingReminderRow | null> {
        const rows = await this.db.query<MeetingReminderRow[]>(
            `SELECT * FROM meeting_reminders WHERE id = ?`,
            [id],
        );
        return rows[0] || null;
    }

    async findByMeetingAndUser(meetingId: number, userId: number): Promise<MeetingReminderRow | null> {
        const rows = await this.db.query<MeetingReminderRow[]>(
            `SELECT * FROM meeting_reminders
            WHERE meeting_id = ? AND user_id = ? AND is_sent = 0`,
            [meetingId, userId],
        );
        return rows[0] || null;
    }

    async create(data: CreateMeetingReminderData): Promise<number> {
        const result = await this.db.query<ResultSetHeader>(
            `INSERT INTO meeting_reminders (meeting_id, user_id, remind_at)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE remind_at = VALUES(remind_at), is_sent = 0`,
            [data.meeting_id, data.user_id, data.remind_at],
        );
        return result.insertId;
    }

    async findDueReminders(now: Date | string): Promise<MeetingReminderRow[]> {
        return this.db.query<MeetingReminderRow[]>(
            `SELECT * FROM meeting_reminders
            WHERE is_sent = 0 AND remind_at <= ?
            ORDER BY remind_at ASC
            LIMIT 100`,
            [now],
        );
    }

    async markAsSent(ids: number[]): Promise<void> {
        if (ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(',');
        await this.db.query(
            `UPDATE meeting_reminders SET is_sent = 1 WHERE id IN (${placeholders})`,
            ids,
        );
    }

    async delete(id: number, userId: number): Promise<boolean> {
        const result = await this.db.query<ResultSetHeader>(
            `DELETE FROM meeting_reminders WHERE id = ? AND user_id = ?`,
            [id, userId],
        );
        return result.affectedRows > 0;
    }
}
