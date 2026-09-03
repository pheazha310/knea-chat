/**
 * WorkScheduleRepository — data access for the `work_schedules` table.
 * One row per employee per day-of-week; defaults are materialized by the
 * service (see WorkSchedule.service.ts).
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type {
  WorkScheduleRow,
  CreateWorkScheduleData,
  UpdateWorkScheduleData,
} from '../types';

export class WorkScheduleRepository {
  constructor(private db: Db) {}

  /** Project TIME columns to 'HH:MM' so the API never leaks 'HH:MM:SS'. */
  private static SELECT = `ws.id, ws.employee_id, ws.day_of_week,
    TIME_FORMAT(ws.start_time, '%H:%i') AS start_time,
    TIME_FORMAT(ws.end_time, '%H:%i') AS end_time,
    ws.break_minutes, ws.required_work_minutes, ws.is_working_day,
    ws.created_at, ws.updated_at`;

  async findByEmployee(employeeId: number): Promise<WorkScheduleRow[]> {
    return this.db.query<WorkScheduleRow[]>(
      `SELECT ${WorkScheduleRepository.SELECT} FROM work_schedules ws
       WHERE ws.employee_id = ? ORDER BY ws.day_of_week ASC`,
      [employeeId],
    );
  }

  /** Every schedule row in a company, joined to employee names. */
  async findAllByCompany(
    companyId: number,
  ): Promise<Array<WorkScheduleRow & { first_name?: string; last_name?: string }>> {
    return this.db.query(
      `SELECT ${WorkScheduleRepository.SELECT}, u.first_name, u.last_name
       FROM work_schedules ws
       JOIN users u ON u.id = ws.employee_id
       WHERE u.company_id = ?
       ORDER BY u.first_name ASC, ws.day_of_week ASC`,
      [companyId],
    );
  }

  async findById(id: number): Promise<WorkScheduleRow | null> {
    const rows = await this.db.query<WorkScheduleRow[]>(
      `SELECT ${WorkScheduleRepository.SELECT} FROM work_schedules ws WHERE ws.id = ?`,
      [id],
    );
    return rows[0] || null;
  }

  async findByEmployeeAndDay(
    employeeId: number,
    dayOfWeek: number,
  ): Promise<WorkScheduleRow | null> {
    const rows = await this.db.query<WorkScheduleRow[]>(
      `SELECT ${WorkScheduleRepository.SELECT} FROM work_schedules ws
       WHERE ws.employee_id = ? AND ws.day_of_week = ?`,
      [employeeId, dayOfWeek],
    );
    return rows[0] || null;
  }

  async create(data: CreateWorkScheduleData): Promise<number> {
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO work_schedules
        (employee_id, day_of_week, start_time, end_time, break_minutes, required_work_minutes, is_working_day)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.employee_id,
        data.day_of_week,
        data.start_time ?? null,
        data.end_time ?? null,
        data.break_minutes ?? 60,
        data.required_work_minutes ?? 480,
        data.is_working_day ?? 1,
      ],
    );
    return result.insertId;
  }

  /** Insert multiple rows (used to materialize the default weekly schedule). */
  async createMany(rows: CreateWorkScheduleData[]): Promise<void> {
    if (rows.length === 0) return;
    const values = rows
      .map(() => '(?, ?, ?, ?, ?, ?, ?)')
      .join(', ');
    const params: unknown[] = [];
    for (const r of rows) {
      params.push(
        r.employee_id,
        r.day_of_week,
        r.start_time ?? null,
        r.end_time ?? null,
        r.break_minutes ?? 60,
        r.required_work_minutes ?? 480,
        r.is_working_day ?? 1,
      );
    }
    await this.db.query<ResultSetHeader>(
      `INSERT INTO work_schedules
        (employee_id, day_of_week, start_time, end_time, break_minutes, required_work_minutes, is_working_day)
       VALUES ${values}`,
      params,
    );
  }

  async update(id: number, data: UpdateWorkScheduleData): Promise<boolean> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (data.start_time !== undefined) {
      updates.push('start_time = ?');
      params.push(data.start_time);
    }
    if (data.end_time !== undefined) {
      updates.push('end_time = ?');
      params.push(data.end_time);
    }
    if (data.break_minutes !== undefined) {
      updates.push('break_minutes = ?');
      params.push(data.break_minutes);
    }
    if (data.required_work_minutes !== undefined) {
      updates.push('required_work_minutes = ?');
      params.push(data.required_work_minutes);
    }
    if (data.is_working_day !== undefined) {
      updates.push('is_working_day = ?');
      params.push(data.is_working_day);
    }

    if (updates.length === 0) return false;
    params.push(id);
    const result = await this.db.query<ResultSetHeader>(
      `UPDATE work_schedules SET ${updates.join(', ')} WHERE id = ?`,
      params,
    );
    return result.affectedRows > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'DELETE FROM work_schedules WHERE id = ?',
      [id],
    );
    return result.affectedRows > 0;
  }
}