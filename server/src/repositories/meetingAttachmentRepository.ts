import type { Db, ResultSetHeader } from "../database/connection";
import type { MeetingAttachmentRow, CreateMeetingAttachmentData } from "../types/Meeting";

export class MeetingAttachmentRepository {
    constructor(private db: Db) {}

    async findAllByMeeting(meetingId: number): Promise<MeetingAttachmentRow[]> {
        return this.db.query<MeetingAttachmentRow[]>(
            `SELECT a.*, u.first_name AS uploader_first_name, u.last_name AS uploader_last_name
            FROM meeting_attachments a
            LEFT JOIN users u ON a.uploaded_by = u.id
            WHERE a.meeting_id = ?
            ORDER BY a.created_at ASC`,
            [meetingId],
        );
    }

    async findById(id: number): Promise<MeetingAttachmentRow | null> {
        const rows = await this.db.query<MeetingAttachmentRow[]>(
            `SELECT a.*, u.first_name AS uploader_first_name, u.last_name AS uploader_last_name
            FROM meeting_attachments a
            LEFT JOIN users u ON a.uploaded_by = u.id
            WHERE a.id = ?`,
            [id],
        );
        return rows[0] || null;
    }

    async create(data: CreateMeetingAttachmentData): Promise<number> {
        const result = await this.db.query<ResultSetHeader>(
            `INSERT INTO meeting_attachments (meeting_id, uploaded_by, file_name, file_url, file_type, file_size)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [data.meeting_id, data.uploaded_by, data.file_name, data.file_url, data.file_type || null, data.file_size || null],
        );
        return result.insertId;
    }

    async delete(id: number): Promise<boolean> {
        const result = await this.db.query<ResultSetHeader>(
            `DELETE FROM meeting_attachments WHERE id = ?`,
            [id],
        );
        return result.affectedRows > 0;
    }

    async deleteByMeeting(meetingId: number): Promise<boolean> {
        const result = await this.db.query<ResultSetHeader>(
            `DELETE FROM meeting_attachments WHERE meeting_id = ?`,
            [meetingId],
        );
        return result.affectedRows > 0;
    }
}
