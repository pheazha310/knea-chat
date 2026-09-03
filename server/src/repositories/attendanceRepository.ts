/**
 * AttendanceRepository — data access for attendance_records, break_records and
 * overtime_records. Business logic / status calculation lives in the service.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type {
  AttendanceRecordRow,
  BreakRecordRow,
  OvertimeRecordRow,
  RequestStatus,
} from '../types';

export interface CreateAttendanceData {
  employee_id: number;
  date: string; // YYYY-MM-DD
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  required_work_minutes?: number;
}

export interface UpdateAttendanceData {
  clock_in?: Date | string | null;
  clock_out?: Date | string | null;
  total_work_minutes?: number | null;
  late_minutes?: number;
  early_leave_minutes?: number;
  overtime_minutes?: number;
  status?: string;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  required_work_minutes?: number;
}

export class AttendanceRepository {
  constructor(private db: Db) {}

  /** DATE columns arrive from MySQL as UTC Date objects; always project them
   *  back to 'YYYY-MM-DD' strings so date map lookups stay timezone-safe. */
  private static DATE_SELECT = `DATE_FORMAT(ar.date, '%Y-%m-%d') AS date, ar.id, ar.employee_id,
    TIME_FORMAT(ar.scheduled_start, '%H:%i') AS scheduled_start,
    TIME_FORMAT(ar.scheduled_end, '%H:%i') AS scheduled_end,
    ar.required_work_minutes, ar.clock_in, ar.clock_out,
    ar.total_work_minutes, ar.late_minutes, ar.early_leave_minutes, ar.overtime_minutes,
    ar.status, ar.created_at, ar.updated_at`;

  async findByEmployeeAndDate(
    employeeId: number,
    date: string,
  ): Promise<AttendanceRecordRow | null> {
    const rows = await this.db.query<AttendanceRecordRow[]>(
      `SELECT ${AttendanceRepository.DATE_SELECT}
       FROM attendance_records ar WHERE ar.employee_id = ? AND ar.date = ?`,
      [employeeId, date],
    );
    return rows[0] || null;
  }

  async findById(id: number): Promise<AttendanceRecordRow | null> {
    const rows = await this.db.query<AttendanceRecordRow[]>(
      `SELECT ${AttendanceRepository.DATE_SELECT}
       FROM attendance_records ar WHERE ar.id = ?`,
      [id],
    );
    return rows[0] || null;
  }

  async findByEmployeeBetween(
    employeeId: number,
    startDate: string,
    endDate: string,
  ): Promise<AttendanceRecordRow[]> {
    return this.db.query<AttendanceRecordRow[]>(
      `SELECT ${AttendanceRepository.DATE_SELECT}
       FROM attendance_records ar
       WHERE ar.employee_id = ? AND ar.date BETWEEN ? AND ? ORDER BY ar.date ASC`,
      [employeeId, startDate, endDate],
    );
  }

  /** Records for a company between two dates, joined to user metadata. */
  async findByCompanyBetween(
    companyId: number,
    startDate: string,
    endDate: string,
  ): Promise<AttendanceRecordRow[]> {
    return this.db.query<AttendanceRecordRow[]>(
      `SELECT ${AttendanceRepository.DATE_SELECT}, u.first_name, u.last_name, u.department_id, d.name AS department_name
       FROM attendance_records ar
       JOIN users u ON u.id = ar.employee_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.company_id = ? AND ar.date BETWEEN ? AND ?
       ORDER BY ar.date ASC, u.first_name ASC`,
      [companyId, startDate, endDate],
    );
  }

  async create(data: CreateAttendanceData): Promise<number> {
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO attendance_records
        (employee_id, date, scheduled_start, scheduled_end, required_work_minutes)
       VALUES (?, ?, ?, ?, ?)`,
      [
        data.employee_id,
        data.date,
        data.scheduled_start ?? null,
        data.scheduled_end ?? null,
        data.required_work_minutes ?? 480,
      ],
    );
    return result.insertId;
  }

  async update(id: number, data: UpdateAttendanceData): Promise<boolean> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (data.clock_in !== undefined) {
      updates.push('clock_in = ?');
      params.push(data.clock_in);
    }
    if (data.clock_out !== undefined) {
      updates.push('clock_out = ?');
      params.push(data.clock_out);
    }
    if (data.total_work_minutes !== undefined) {
      updates.push('total_work_minutes = ?');
      params.push(data.total_work_minutes);
    }
    if (data.late_minutes !== undefined) {
      updates.push('late_minutes = ?');
      params.push(data.late_minutes);
    }
    if (data.early_leave_minutes !== undefined) {
      updates.push('early_leave_minutes = ?');
      params.push(data.early_leave_minutes);
    }
    if (data.overtime_minutes !== undefined) {
      updates.push('overtime_minutes = ?');
      params.push(data.overtime_minutes);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(data.status);
    }
    if (data.scheduled_start !== undefined) {
      updates.push('scheduled_start = ?');
      params.push(data.scheduled_start);
    }
    if (data.scheduled_end !== undefined) {
      updates.push('scheduled_end = ?');
      params.push(data.scheduled_end);
    }
    if (data.required_work_minutes !== undefined) {
      updates.push('required_work_minutes = ?');
      params.push(data.required_work_minutes);
    }

    if (updates.length === 0) return false;
    params.push(id);
    const result = await this.db.query<ResultSetHeader>(
      `UPDATE attendance_records SET ${updates.join(', ')} WHERE id = ?`,
      params,
    );
    return result.affectedRows > 0;
  }

  /** Department names for a set of ids (manager table metadata). */
  async findDepartmentNames(ids: number[]): Promise<Array<{ id: number; name: string }>> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.query<Array<{ id: number; name: string }>>(
      `SELECT id, name FROM departments WHERE id IN (${placeholders})`,
      ids,
    );
  }

  /** Employees who have NO record for the given date (used by the dashboard
   *  to count people who have not clocked in yet). */
  async findMissingForDate(
    companyId: number,
    date: string,
  ): Promise<Array<{ employee_id: number; first_name: string; last_name: string; department_id: number | null }>> {
    return this.db.query(
      `SELECT u.id AS employee_id, u.first_name, u.last_name, u.department_id
       FROM users u
       WHERE u.company_id = ? AND u.is_active = 1
         AND NOT EXISTS (
           SELECT 1 FROM attendance_records ar
           WHERE ar.employee_id = u.id AND ar.date = ?
         )`,
      [companyId, date],
    );
  }

  // -------------------------------------------------------------------------
  // break_records
  // -------------------------------------------------------------------------
  async createBreak(attendanceId: number, breakStart: Date): Promise<number> {
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO break_records (attendance_id, break_start) VALUES (?, ?)',
      [attendanceId, breakStart],
    );
    return result.insertId;
  }

  async findRunningBreak(attendanceId: number): Promise<BreakRecordRow | null> {
    const rows = await this.db.query<BreakRecordRow[]>(
      'SELECT * FROM break_records WHERE attendance_id = ? AND break_end IS NULL ORDER BY id DESC LIMIT 1',
      [attendanceId],
    );
    return rows[0] || null;
  }

  async endBreak(
    id: number,
    breakEnd: Date,
    durationMinutes: number,
  ): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'UPDATE break_records SET break_end = ?, duration_minutes = ? WHERE id = ?',
      [breakEnd, durationMinutes, id],
    );
    return result.affectedRows > 0;
  }

  async findBreaksByAttendance(attendanceId: number): Promise<BreakRecordRow[]> {
    return this.db.query<BreakRecordRow[]>(
      'SELECT * FROM break_records WHERE attendance_id = ? ORDER BY break_start ASC',
      [attendanceId],
    );
  }

  async totalBreakMinutes(attendanceId: number): Promise<number> {
    const rows = await this.db.query<Array<{ total: number | null }>>(
      'SELECT SUM(duration_minutes) AS total FROM break_records WHERE attendance_id = ?',
      [attendanceId],
    );
    return Number(rows[0]?.total || 0);
  }

  // -------------------------------------------------------------------------
  // overtime_records
  // -------------------------------------------------------------------------
  /** Project DATE columns back to 'YYYY-MM-DD' strings (TZ-safe). */
  private static OVERTIME_SELECT = `ot.id, ot.employee_id, DATE_FORMAT(ot.date, '%Y-%m-%d') AS date,
    ot.attendance_id, ot.minutes, ot.reason, ot.status, ot.approved_by, ot.created_at, ot.updated_at`;

  async createOvertime(data: {
    employee_id: number;
    date: string;
    attendance_id: number | null;
    minutes: number;
    reason?: string | null;
  }): Promise<number> {
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO overtime_records (employee_id, date, attendance_id, minutes, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [data.employee_id, data.date, data.attendance_id, data.minutes, data.reason ?? null],
    );
    return result.insertId;
  }

  async findOvertimeById(id: number): Promise<OvertimeRecordRow | null> {
    const rows = await this.db.query<OvertimeRecordRow[]>(
      `SELECT ${AttendanceRepository.OVERTIME_SELECT} FROM overtime_records ot WHERE ot.id = ?`,
      [id],
    );
    return rows[0] || null;
  }

  /** Overtime requests for one employee (newest first). */
  async findOvertimeByEmployee(employeeId: number): Promise<OvertimeRecordRow[]> {
    return this.db.query<OvertimeRecordRow[]>(
      `SELECT ${AttendanceRepository.OVERTIME_SELECT} FROM overtime_records ot
       WHERE ot.employee_id = ? ORDER BY ot.created_at DESC`,
      [employeeId],
    );
  }

  /** Overtime requests for a company, joined to user metadata. */
  async findOvertimeByCompany(
    companyId: number,
    status?: RequestStatus | '',
  ): Promise<OvertimeRecordRow[]> {
    let sql = `SELECT ${AttendanceRepository.OVERTIME_SELECT}, u.first_name AS employee_first_name,
                      u.last_name AS employee_last_name, ap.first_name AS approver_first_name,
                      ap.last_name AS approver_last_name
               FROM overtime_records ot
               JOIN users u ON u.id = ot.employee_id
               LEFT JOIN users ap ON ap.id = ot.approved_by
               WHERE u.company_id = ?`;
    const params: unknown[] = [companyId];
    if (status) {
      sql += ' AND ot.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY ot.created_at DESC';
    return this.db.query<OvertimeRecordRow[]>(sql, params);
  }

  async findOvertimeByEmployeeAndDate(
    employeeId: number,
    date: string,
  ): Promise<OvertimeRecordRow[]> {
    return this.db.query<OvertimeRecordRow[]>(
      `SELECT ${AttendanceRepository.OVERTIME_SELECT} FROM overtime_records ot
       WHERE ot.employee_id = ? AND ot.date = ?`,
      [employeeId, date],
    );
  }

  async setOvertimeStatus(
    id: number,
    status: RequestStatus,
    approvedBy: number,
  ): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'UPDATE overtime_records SET status = ?, approved_by = ? WHERE id = ?',
      [status, approvedBy, id],
    );
    return result.affectedRows > 0;
  }
}