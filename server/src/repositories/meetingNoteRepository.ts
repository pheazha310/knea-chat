import type { Db, ResultSetHeader } from "../database/connection";
import type { MeetingNoteRow, CreateMeetingNoteData } from "../types/Meeting";

export class MeetingNoteRepository {
    constructor(private db: Db) {}

    async findAllByMeeting(meetingId: number): Promise<MeetingNoteRow[]> {
        return this.db.query<MeetingNoteRow[]>(
            `SELECT n.*, u.first_name AS user_first_name, u.last_name AS user_last_name
            FROM meeting_notes n
            LEFT JOIN users u ON n.user_id = u.id
            WHERE n.meeting_id = ?
            ORDER BY n.created_at ASC`,
            [meetingId],
        );
    }

    async findById(id: number): Promise<MeetingNoteRow | null> {
        const rows = await this.db.query<MeetingNoteRow[]>(
            `SELECT n.*, u.first_name AS user_first_name, u.last_name AS user_last_name
            FROM meeting_notes n
            LEFT JOIN users u ON n.user_id = u.id
            WHERE n.id = ?`,
            [id],
        );
        return rows[0] || null;
    }

    async create(data: CreateMeetingNoteData): Promise<number> {
        const result = await this.db.query<ResultSetHeader>(
            `INSERT INTO meeting_notes (meeting_id, user_id, content)
            VALUES (?, ?, ?)`,
            [data.meeting_id, data.user_id, data.content],
        );
        return result.insertId;
    }

    async update(id: number, content: string): Promise<boolean> {
        const result = await this.db.query<ResultSetHeader>(
            `UPDATE meeting_notes SET content = ? WHERE id = ?`,
            [content, id],
        );
        return result.affectedRows > 0;
    }

    async delete(id: number): Promise<boolean> {
        const result = await this.db.query<ResultSetHeader>(
            `DELETE FROM meeting_notes WHERE id = ?`,
            [id],
        );
        return result.affectedRows > 0;
    }
}
