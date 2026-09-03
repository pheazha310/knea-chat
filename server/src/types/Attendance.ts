/**
 * Employee Working Time & Attendance — domain types.
 *
 * Statuses are calculated by the backend (see Attendance.service.ts):
 *   present / late / absent / leave / holiday / day_off / early_leave /
 *   under_time / overtime. `not_started` is used for the current day before
 *   the employee clocks in (never persisted — derived on read).
 */

export type AttendanceStatus =
  | 'present'
  | 'late'
  | 'absent'
  | 'leave'
  | 'holiday'
  | 'day_off'
  | 'early_leave'
  | 'under_time'
  | 'overtime';

export type LeaveType = 'annual' | 'sick' | 'personal' | 'unpaid';
export type RequestStatus = 'pending' | 'approved' | 'rejected';

// ---------------------------------------------------------------------------
// work_schedules
// ---------------------------------------------------------------------------
export interface WorkScheduleRow {
  id: number;
  employee_id: number;
  day_of_week: number; // 0=Sunday .. 6=Saturday
  start_time: string | null; // 'HH:MM' when working day
  end_time: string | null;
  break_minutes: number;
  required_work_minutes: number;
  is_working_day: number; // 0 | 1
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CreateWorkScheduleData {
  employee_id: number;
  day_of_week: number;
  start_time?: string | null;
  end_time?: string | null;
  break_minutes?: number;
  required_work_minutes?: number;
  is_working_day?: number;
}

export interface UpdateWorkScheduleData {
  start_time?: string | null;
  end_time?: string | null;
  break_minutes?: number;
  required_work_minutes?: number;
  is_working_day?: number;
}

// ---------------------------------------------------------------------------
// attendance_records
// ---------------------------------------------------------------------------
export interface AttendanceRecordRow {
  id: number;
  employee_id: number;
  date: string; // YYYY-MM-DD
  scheduled_start: string | null;
  scheduled_end: string | null;
  required_work_minutes: number;
  clock_in: Date | string | null;
  clock_out: Date | string | null;
  total_work_minutes: number | null;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  status: AttendanceStatus;
  created_at: Date | string;
  updated_at: Date | string;
  // joined metadata (manager views)
  first_name?: string;
  last_name?: string;
  department_id?: number | null;
  department_name?: string | null;
}

// ---------------------------------------------------------------------------
// break_records
// ---------------------------------------------------------------------------
export interface BreakRecordRow {
  id: number;
  attendance_id: number;
  break_start: Date | string;
  break_end: Date | string | null;
  duration_minutes: number;
  created_at: Date | string;
  updated_at: Date | string;
}

// ---------------------------------------------------------------------------
// leave_requests
// ---------------------------------------------------------------------------
export interface LeaveRequestRow {
  id: number;
  employee_id: number;
  leave_type: LeaveType;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  reason: string | null;
  status: RequestStatus;
  approved_by: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  // joined metadata
  employee_first_name?: string;
  employee_last_name?: string;
  approver_first_name?: string;
  approver_last_name?: string;
}

export interface CreateLeaveRequestData {
  employee_id: number;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// holidays
// ---------------------------------------------------------------------------
export interface HolidayRow {
  id: number;
  name: string;
  date: string; // YYYY-MM-DD
  description: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CreateHolidayData {
  name: string;
  date: string;
  description?: string;
}

export interface UpdateHolidayData {
  name?: string;
  date?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// overtime_records
// ---------------------------------------------------------------------------
export interface OvertimeRecordRow {
  id: number;
  employee_id: number;
  /** Work date the overtime belongs to (may be null for legacy rows). */
  date: string | null;
  attendance_id: number | null;
  minutes: number;
  reason: string | null;
  status: RequestStatus;
  approved_by: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  // joined metadata (manager view)
  employee_first_name?: string;
  employee_last_name?: string;
  approver_first_name?: string;
  approver_last_name?: string;
}

// ---------------------------------------------------------------------------
// API payloads / computed shapes
// ---------------------------------------------------------------------------

/** One calendar day for a single employee — schedule + attendance merged. */
export interface AttendanceDay {
  date: string;
  day_of_week: number;
  is_working_day: boolean;
  is_day_off: boolean;
  is_holiday: boolean;
  holiday_name?: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  break_minutes: number;
  required_work_minutes: number;
  clock_in: string | null;
  clock_out: string | null;
  total_work_minutes: number | null;
  late_minutes: number;
  early_leave_minutes: number;
  under_time_minutes: number;
  overtime_minutes: number;
  status: AttendanceStatus | 'not_started' | null;
  /** True while a break is running (only meaningful for today). */
  running_break?: boolean;
}

/** Monthly roll-up shown on the employee calendar. */
export interface AttendanceMonthSummary {
  year: number;
  month: number; // 1-based
  working_days: number;
  present: number;
  late: number;
  absent: number;
  leave: number;
  day_off: number;
  holidays: number;
  required_minutes: number;
  actual_minutes: number;
  under_time_minutes: number;
  overtime_minutes: number;
  attendance_rate: number | null; // 0-100, null when no working days
}

/** Today's dashboard for managers. */
export interface AttendanceDashboard {
  date: string;
  total_employees: number;
  present: number;
  late: number;
  absent: number;
  on_leave: number;
  day_off: number;
  holiday: number;
  not_started: number;
  currently_working: number;
  on_break: number;
}

/** Row in the manager employee×day table. */
export interface EmployeeAttendanceRow {
  employee_id: number;
  first_name: string;
  last_name: string;
  department_id: number | null;
  department_name: string | null;
  days: AttendanceDay[];
  summary: {
    working_days: number;
    present: number;
    late: number;
    absent: number;
    leave: number;
    day_off: number;
    holidays: number;
    required_minutes: number;
    actual_minutes: number;
    under_time_minutes: number;
    overtime_minutes: number;
    attendance_rate: number | null;
  };
}