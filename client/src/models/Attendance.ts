// Employee Working Time & Attendance — client domain model.
// Types mirror the server payloads (server/src/types/Attendance.ts); the
// Model objects talk to the REST API through the shared axios client.
import api from '../services/api';

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

export type DayStatus = AttendanceStatus | 'not_started' | null;

export type LeaveType = 'annual' | 'sick' | 'personal' | 'unpaid';
export type RequestStatus = 'pending' | 'approved' | 'rejected';

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
export interface WorkSchedule {
  id: number;
  employee_id: number;
  day_of_week: number; // 0=Sunday .. 6=Saturday
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  required_work_minutes: number;
  is_working_day: number; // 0 | 1
  created_at?: string;
  updated_at?: string;
  first_name?: string;
  last_name?: string;
}

export interface AttendanceDay {
  date: string; // YYYY-MM-DD
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
  status: DayStatus;
  /** True while a break is running (only set on today's card). */
  running_break?: boolean;
}

export interface AttendanceMonthSummary {
  year: number;
  month: number;
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
}

export interface AttendanceRecord {
  id: number;
  employee_id: number;
  date: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  required_work_minutes: number;
  clock_in: string | null;
  clock_out: string | null;
  total_work_minutes: number | null;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  status: AttendanceStatus;
}

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

export interface LeaveRequest {
  id: number;
  employee_id: number;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: RequestStatus;
  approved_by: number | null;
  created_at?: string;
  updated_at?: string;
  employee_first_name?: string;
  employee_last_name?: string;
  approver_first_name?: string;
  approver_last_name?: string;
}

export interface Holiday {
  id: number;
  name: string;
  date: string;
  description: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface OvertimeRequest {
  id: number;
  employee_id: number;
  /** Work date the overtime belongs to. */
  date: string | null;
  attendance_id: number | null;
  minutes: number;
  reason: string | null;
  status: RequestStatus;
  approved_by: number | null;
  created_at?: string;
  updated_at?: string;
  // joined metadata (manager view)
  employee_first_name?: string;
  employee_last_name?: string;
  approver_first_name?: string;
  approver_last_name?: string;
}

export interface EmployeeAttendanceDetail {
  employee: {
    id: number;
    first_name: string;
    last_name: string;
    department_id: number | null;
    department_name: string | null;
  };
  days: AttendanceDay[];
  summary: AttendanceMonthSummary;
}

// ---------------------------------------------------------------------------
// Status metadata (icons + labels shared by every view)
// ---------------------------------------------------------------------------
export const STATUS_META: Record<string, { icon: string; label: string }> = {
  present: { icon: '🟢', label: 'Present' },
  late: { icon: '🟡', label: 'Late' },
  absent: { icon: '🔴', label: 'Absent' },
  leave: { icon: '🔵', label: 'Leave' },
  holiday: { icon: '🎉', label: 'Holiday' },
  day_off: { icon: '⚪', label: 'Day Off' },
  early_leave: { icon: '🌅', label: 'Early Leave' },
  under_time: { icon: '⏳', label: 'Under Time' },
  overtime: { icon: '➕', label: 'Overtime' },
  not_started: { icon: '○', label: 'Not started' },
};

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  annual: 'Annual Leave',
  sick: 'Sick Leave',
  personal: 'Personal Leave',
  unpaid: 'Unpaid Leave',
};

// ---------------------------------------------------------------------------
// API models
// ---------------------------------------------------------------------------
export const AttendanceModel = {
  clockIn: () => api.post<{ success: boolean; message: string; data: { record: AttendanceRecord } }>('/attendance/clock-in', {}),
  clockOut: () => api.post<{ success: boolean; message: string; data: { record: AttendanceRecord } }>('/attendance/clock-out', {}),
  breakStart: () => api.post<{ success: boolean; message: string; data: { breakId: number; startedAt: string } }>('/attendance/break/start', {}),
  breakEnd: () => api.post<{ success: boolean; message: string; data: { breakId: number; durationMinutes: number } }>('/attendance/break/end', {}),
  meToday: () => api.get<{ success: boolean; data: { day: AttendanceDay } }>('/attendance/me/today'),
  meMonth: (year: number, month: number) =>
    api.get<{ success: boolean; data: { days: AttendanceDay[]; summary: AttendanceMonthSummary } }>(`/attendance/me/month?year=${year}&month=${month}`),
  employees: (params: { year: number; month: number; department_id?: number; status?: string }) => {
    const qs = new URLSearchParams({ year: String(params.year), month: String(params.month) });
    if (params.department_id) qs.set('department_id', String(params.department_id));
    if (params.status) qs.set('status', params.status);
    return api.get<{ success: boolean; data: { employees: EmployeeAttendanceRow[] } }>(`/attendance/employees?${qs.toString()}`);
  },
  employeeDetail: (employeeId: number, year: number, month: number) =>
    api.get<{ success: boolean; data: EmployeeAttendanceDetail }>(`/attendance/employee/${employeeId}?year=${year}&month=${month}`),
  report: (year: number, month: number) =>
    api.get<{ success: boolean; data: { report: Array<EmployeeAttendanceRow['summary'] & { employee_id: number; first_name: string; last_name: string; department_name: string | null }> } }>(`/attendance/report?year=${year}&month=${month}`),
  dashboard: (date?: string) =>
    api.get<{ success: boolean; data: { dashboard: AttendanceDashboard } }>(`/attendance/dashboard${date ? `?date=${date}` : ''}`),
};

export const WorkScheduleModel = {
  getAll: () => api.get<{ success: boolean; data: { schedules: WorkSchedule[] } }>('/work-schedules'),
  getByEmployee: (employeeId: number) =>
    api.get<{ success: boolean; data: { schedules: WorkSchedule[] } }>(`/work-schedules/${employeeId}`),
  upsert: (data: {
    employee_id: number;
    day_of_week: number;
    start_time?: string | null;
    end_time?: string | null;
    break_minutes?: number;
    required_work_minutes?: number;
    is_working_day?: number;
  }) => api.post<{ success: boolean; data: { schedule: WorkSchedule } }>('/work-schedules', data),
  update: (id: number, data: Partial<Omit<WorkSchedule, 'id' | 'employee_id' | 'day_of_week'>>) =>
    api.put<{ success: boolean; data: { schedule: WorkSchedule } }>(`/work-schedules/${id}`, data),
  remove: (id: number) => api.delete<{ success: boolean; message: string }>(`/work-schedules/${id}`),
};

export const LeaveRequestModel = {
  create: (data: { leave_type: LeaveType; start_date: string; end_date: string; reason?: string }) =>
    api.post<{ success: boolean; message: string; data: { leave: LeaveRequest } }>('/leave-requests', data),
  list: (status?: RequestStatus | '') =>
    api.get<{ success: boolean; data: { leaves: LeaveRequest[] } }>(`/leave-requests${status ? `?status=${status}` : ''}`),
  approve: (id: number) => api.put<{ success: boolean; message: string; data: { leave: LeaveRequest } }>(`/leave-requests/${id}/approve`, {}),
  reject: (id: number) => api.put<{ success: boolean; message: string; data: { leave: LeaveRequest } }>(`/leave-requests/${id}/reject`, {}),
};

export const HolidayModel = {
  list: () => api.get<{ success: boolean; data: { holidays: Holiday[] } }>('/holidays'),
  create: (data: { name: string; date: string; description?: string }) =>
    api.post<{ success: boolean; message: string; data: { holiday: Holiday } }>('/holidays', data),
  update: (id: number, data: { name?: string; date?: string; description?: string }) =>
    api.put<{ success: boolean; message: string; data: { holiday: Holiday } }>(`/holidays/${id}`, data),
  remove: (id: number) => api.delete<{ success: boolean; message: string }>(`/holidays/${id}`),
};

export const OvertimeModel = {
  create: (data: { date: string; minutes: number; reason?: string }) =>
    api.post<{ success: boolean; message: string; data: { overtime: OvertimeRequest } }>('/overtime', data),
  list: () => api.get<{ success: boolean; data: { overtime: OvertimeRequest[] } }>('/overtime'),
  approve: (id: number) =>
    api.put<{ success: boolean; message: string; data: { overtime: OvertimeRequest } }>(`/overtime/${id}/approve`, {}),
  reject: (id: number) =>
    api.put<{ success: boolean; message: string; data: { overtime: OvertimeRequest } }>(`/overtime/${id}/reject`, {}),
};