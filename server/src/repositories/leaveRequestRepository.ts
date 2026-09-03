/**
 * LeaveRequestRepository — data access for the `leave_requests` table.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { CreateLeaveRequestData, LeaveRequestRow, RequestStatus } from '../types';

export class LeaveRequestRepository {
  constructor(private db: Db) {}

  /** Project DATE columns back to 'YYYY-MM-DD' strings (TZ-safe). */
  private static SELECT = `lr.id, lr.employee_id, lr.leave_type,
    DATE_FORMAT(lr.start_date, '%Y-%m-%d') AS start_date,
    DATE_FORMAT(lr.end_date, '%Y-%m-%d') AS end_date,
    lr.reason, lr.status, lr.approved_by, lr.created_at, lr.updated_at`;

  async create(data: CreateLeaveRequestData): Promise<number> {
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [data.employee_id, data.leave_type, data.start_date, data.end_date, data.reason ?? null],
    );
    return result.insertId;
  }

  async findById(id: number): Promise<LeaveRequestRow | null> {
    const rows = await this.db.query<LeaveRequestRow[]>(
      `SELECT ${LeaveRequestRepository.SELECT} FROM leave_requests lr WHERE lr.id = ?`,
      [id],
    );
    return rows[0] || null;
  }

  /** Leave requests for one employee (newest first). */
  async findByEmployee(employeeId: number): Promise<LeaveRequestRow[]> {
    return this.db.query<LeaveRequestRow[]>(
      `SELECT ${LeaveRequestRepository.SELECT} FROM leave_requests lr
       WHERE lr.employee_id = ? ORDER BY lr.created_at DESC`,
      [employeeId],
    );
  }

  /** All leave requests in a company, joined to user metadata. */
  async findByCompany(
    companyId: number,
    status?: RequestStatus | '',
  ): Promise<LeaveRequestRow[]> {
    let sql = `SELECT ${LeaveRequestRepository.SELECT}, u.first_name AS employee_first_name, u.last_name AS employee_last_name,
                      ap.first_name AS approver_first_name, ap.last_name AS approver_last_name
               FROM leave_requests lr
               JOIN users u ON u.id = lr.employee_id
               LEFT JOIN users ap ON ap.id = lr.approved_by
               WHERE u.company_id = ?`;
    const params: unknown[] = [companyId];
    if (status) {
      sql += ' AND lr.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY lr.created_at DESC';
    return this.db.query<LeaveRequestRow[]>(sql, params);
  }

  /** Approved leave overlapping [start, end] for an employee. */
  async findApprovedOverlap(
    employeeId: number,
    startDate: string,
    endDate: string,
  ): Promise<LeaveRequestRow[]> {
    return this.db.query<LeaveRequestRow[]>(
      `SELECT ${LeaveRequestRepository.SELECT} FROM leave_requests lr
       WHERE lr.employee_id = ? AND lr.status = 'approved'
         AND lr.start_date <= ? AND lr.end_date >= ?`,
      [employeeId, endDate, startDate],
    );
  }

  /** Any pending/approved request overlapping [start, end] (duplicate guard). */
  async findOverlap(
    employeeId: number,
    startDate: string,
    endDate: string,
  ): Promise<LeaveRequestRow[]> {
    return this.db.query<LeaveRequestRow[]>(
      `SELECT ${LeaveRequestRepository.SELECT} FROM leave_requests lr
       WHERE lr.employee_id = ? AND lr.status IN ('pending', 'approved')
         AND lr.start_date <= ? AND lr.end_date >= ?`,
      [employeeId, endDate, startDate],
    );
  }

  async setStatus(
    id: number,
    status: RequestStatus,
    approvedBy: number,
  ): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'UPDATE leave_requests SET status = ?, approved_by = ? WHERE id = ?',
      [status, approvedBy, id],
    );
    return result.affectedRows > 0;
  }
}