import type { Db, ResultSetHeader } from "../database/connection";
import type { MeetingRow, CreateMeetingData, UpdateMeetingData } from "../types/Meeting";

export interface MeetingFilters {
    search?: string;
    organizer_id?: number;
    department_id?: number;
    team_id?: number;
    status?: 'scheduled' | 'completed' | 'cancelled';
    start_date?: string;
    end_date?: string;
}

export class MeetingRepository {
    constructor(private db: Db) {}

    async findAll(companyId: number, filters: MeetingFilters = {}): Promise<MeetingRow[]> {
        let sql = `SELECT m.*, u.first_name AS organizer_first_name, u.last_name AS organizer_last_name,
                    u.department_id AS organizer_department_id
                    FROM meetings m
                    LEFT JOIN users u ON m.organizer_id = u.id
                    WHERE m.company_id = ?`;
        const params: unknown[] = [companyId];

        if (filters.search) {
            sql += ' AND (m.title LIKE ? OR m.description LIKE ?)';
            params.push(`%${filters.search}%`, `%${filters.search}%`);
        }

        if (filters.organizer_id) {
            sql += ' AND m.organizer_id = ?';
            params.push(filters.organizer_id);
        }

        if (filters.status) {
            sql += ' AND m.status = ?';
            params.push(filters.status);
        }

        if (filters.start_date) {
            sql += ' AND m.meeting_date >= ?';
            params.push(filters.start_date);
        }

        if (filters.end_date) {
            sql += ' AND m.meeting_date <= ?';
            params.push(filters.end_date);
        }

        if (filters.department_id) {
            sql += ' AND u.department_id = ?';
            params.push(filters.department_id);
        }

        if (filters.team_id) {
            sql += ' AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = m.organizer_id AND tm.team_id = ?)';
            params.push(filters.team_id);
        }

        sql += ' ORDER BY m.meeting_date DESC, m.start_time ASC';
        return this.db.query<MeetingRow[]>(sql, params);
    }

    async findById(id: number): Promise<MeetingRow | null> {
        const rows = await this.db.query<MeetingRow[]>(
            `SELECT m.*, u.first_name as organizer_first_name, u.last_name as organizer_last_name
            FROM meetings m
            LEFT JOIN users u ON m.organizer_id = u.id
            WHERE m.id = ?`,
            [id]
        );
        return rows[0] || null;
    }

    async create(data: CreateMeetingData): Promise<number> {
        const participantValues = data.participants || [];
        const participantPlaceholders = participantValues.map(() => '?').join(',');
        const result = await this.db.query<ResultSetHeader>(
            `INSERT INTO meetings (company_id, title, description, meeting_date, start_time, end_time, organizer_id, participants, status, meeting_link, remind_before_minutes, recurrence_pattern, recurrence_interval, recurrence_end_date, recurrence_days)
            VALUES (?, ?, ?, ?, ?, ?, ?, JSON_ARRAY(${participantPlaceholders || ''}), 'scheduled', ?, ?, ?, ?, ?, JSON_ARRAY(?))`,
            [
                data.company_id,
                data.title,
                data.description || null,
                data.meeting_date,
                data.start_time,
                data.end_time,
                data.organizer_id,
                ...participantValues,
                data.meeting_link || null,
                data.remind_before_minutes ?? 15,
                data.recurrence_pattern || 'none',
                data.recurrence_interval || 1,
                data.recurrence_end_date || null,
                data.recurrence_days ? JSON.stringify(data.recurrence_days) : null,
            ],
        );
        return result.insertId;
    }

    async update(id: number, data: UpdateMeetingData): Promise<boolean> {
        const updates: string[] = [];
        const params: unknown[] = [];

        if (data.title !== undefined) {
            updates.push('title = ?');
            params.push(data.title);
        }
        if (data.description !== undefined) {
            updates.push('description = ?');
            params.push(data.description);
        }
        if (data.meeting_date !== undefined) {
            updates.push('meeting_date = ?');
            params.push(data.meeting_date);
        }
        if (data.start_time !== undefined) {
            updates.push('start_time = ?');
            params.push(data.start_time);
        }
        if (data.end_time !== undefined) {
            updates.push('end_time = ?');
            params.push(data.end_time);
        }
        if (data.status !== undefined) {
            updates.push('status = ?');
            params.push(data.status);
        }
        if (data.participants !== undefined) {
            const participantPlaceholders = (data.participants || []).map(() => '?').join(',');
            updates.push(`participants = JSON_ARRAY(${participantPlaceholders || ''})`);
            params.push(...(data.participants || []));
        }
        if (data.recording_url !== undefined) {
            updates.push('recording_url = ?');
            params.push(data.recording_url);
        }
        if (data.recording_status !== undefined) {
            updates.push('recording_status = ?');
            params.push(data.recording_status);
        }
        if (data.calendar_event_id !== undefined) {
            updates.push('calendar_event_id = ?');
            params.push(data.calendar_event_id);
        }
        if (data.calendar_provider !== undefined) {
            updates.push('calendar_provider = ?');
            params.push(data.calendar_provider);
        }
        if (data.meeting_link !== undefined) {
            updates.push('meeting_link = ?');
            params.push(data.meeting_link);
        }
        if (data.remind_before_minutes !== undefined) {
            updates.push('remind_before_minutes = ?');
            params.push(data.remind_before_minutes);
        }
        if (data.recurrence_pattern !== undefined) {
            updates.push('recurrence_pattern = ?');
            params.push(data.recurrence_pattern);
        }
        if (data.recurrence_interval !== undefined) {
            updates.push('recurrence_interval = ?');
            params.push(data.recurrence_interval);
        }
        if (data.recurrence_end_date !== undefined) {
            updates.push('recurrence_end_date = ?');
            params.push(data.recurrence_end_date);
        }
        if (data.recurrence_days !== undefined) {
            updates.push('recurrence_days = ?');
            params.push(data.recurrence_days ? JSON.stringify(data.recurrence_days) : null);
        }

        if (!updates.length) return false;
        params.push(id);
        const result = await this.db.query<ResultSetHeader>(
            `UPDATE meetings SET ${updates.join(', ')} WHERE id = ?`,
            params
        );
        return result.affectedRows > 0;
    }

    async delete(id: number): Promise<boolean> {
        const result = await this.db.query<ResultSetHeader>(
            'DELETE FROM meetings WHERE id = ?',
            [id],
        );
        return result.affectedRows > 0;
    }
}
