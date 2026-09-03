// Attendance store — employee working time & attendance state.
// Owns today/month calendar data, clock in/out actions, the manager dashboard,
// work schedules, leave requests and holidays. WebSocket attendance events are
// dispatched here by wsListeners.ts so the manager dashboard updates live.
import { create } from 'zustand';
import {
  AttendanceModel,
  WorkScheduleModel,
  LeaveRequestModel,
  HolidayModel,
  OvertimeModel,
  type AttendanceDay,
  type AttendanceMonthSummary,
  type AttendanceDashboard,
  type EmployeeAttendanceRow,
  type WorkSchedule,
  type LeaveRequest,
  type LeaveType,
  type Holiday,
  type OvertimeRequest,
} from '../models';
import { getErrorMessage } from './utils';

interface AttendanceState {
  // employee self view
  today: AttendanceDay | null;
  monthDays: AttendanceDay[];
  monthSummary: AttendanceMonthSummary | null;
  loadingToday: boolean;
  loadingMonth: boolean;
  todayError: string | null;

  // manager view
  employees: EmployeeAttendanceRow[];
  dashboard: AttendanceDashboard | null;
  schedules: WorkSchedule[];
  leaves: LeaveRequest[];
  holidays: Holiday[];
  overtime: OvertimeRequest[];
  loadingEmployees: boolean;
  loadingDashboard: boolean;

  loadToday: () => Promise<void>;
  loadMonth: (year: number, month: number) => Promise<void>;
  clockIn: () => Promise<void>;
  clockOut: () => Promise<void>;
  breakStart: () => Promise<void>;
  breakEnd: () => Promise<void>;

  loadEmployees: (params: { year: number; month: number; department_id?: number; status?: string }) => Promise<void>;
  loadDashboard: (date?: string) => Promise<void>;
  loadSchedules: () => Promise<void>;
  saveSchedule: (data: {
    employee_id: number;
    day_of_week: number;
    start_time?: string | null;
    end_time?: string | null;
    break_minutes?: number;
    required_work_minutes?: number;
    is_working_day?: number;
  }) => Promise<void>;
  loadLeaves: (status?: string) => Promise<void>;
  createLeave: (data: { leave_type: LeaveType; start_date: string; end_date: string; reason?: string }) => Promise<void>;
  approveLeave: (id: number) => Promise<void>;
  rejectLeave: (id: number) => Promise<void>;
  loadHolidays: () => Promise<void>;
  createHoliday: (data: { name: string; date: string; description?: string }) => Promise<void>;
  deleteHoliday: (id: number) => Promise<void>;
  loadOvertime: () => Promise<void>;
  requestOvertime: (data: { date: string; minutes: number; reason?: string }) => Promise<void>;
  approveOvertime: (id: number) => Promise<void>;
  rejectOvertime: (id: number) => Promise<void>;

  /** Called by wsListeners when an attendance:* event arrives. */
  handleAttendanceEvent: (type: string) => void;
}

export const useAttendanceStore = create<AttendanceState>()((set, get) => ({
  today: null,
  monthDays: [],
  monthSummary: null,
  loadingToday: false,
  loadingMonth: false,
  todayError: null,
  employees: [],
  dashboard: null,
  schedules: [],
  leaves: [],
  holidays: [],
  overtime: [],
  loadingEmployees: false,
  loadingDashboard: false,

  loadToday: async () => {
    set({ loadingToday: true, todayError: null });
    try {
      const res = await AttendanceModel.meToday();
      set({ today: (res.data as any)?.data?.day ?? null, loadingToday: false });
    } catch (err) {
      set({ todayError: getErrorMessage(err, 'Could not load today'), loadingToday: false });
    }
  },

  loadMonth: async (year, month) => {
    set({ loadingMonth: true });
    try {
      const res = await AttendanceModel.meMonth(year, month);
      set({
        monthDays: (res.data as any)?.data?.days ?? [],
        monthSummary: (res.data as any)?.data?.summary ?? null,
        loadingMonth: false,
      });
    } catch (err) {
      set({ loadingMonth: false, todayError: getErrorMessage(err, 'Could not load month') });
    }
  },

  clockIn: async () => {
    try {
      await AttendanceModel.clockIn();
      await get().loadToday();
      await get().loadMonth(
        new Date().getFullYear(),
        new Date().getMonth() + 1,
      );
    } catch (err) {
      set({ todayError: getErrorMessage(err, 'Could not clock in') });
      throw err;
    }
  },

  clockOut: async () => {
    try {
      await AttendanceModel.clockOut();
      await get().loadToday();
      await get().loadMonth(
        new Date().getFullYear(),
        new Date().getMonth() + 1,
      );
    } catch (err) {
      set({ todayError: getErrorMessage(err, 'Could not clock out') });
      throw err;
    }
  },

  breakStart: async () => {
    try {
      await AttendanceModel.breakStart();
      await get().loadToday();
    } catch (err) {
      set({ todayError: getErrorMessage(err, 'Could not start break') });
      throw err;
    }
  },

  breakEnd: async () => {
    try {
      await AttendanceModel.breakEnd();
      await get().loadToday();
    } catch (err) {
      set({ todayError: getErrorMessage(err, 'Could not end break') });
      throw err;
    }
  },

  loadEmployees: async (params) => {
    set({ loadingEmployees: true });
    try {
      const res = await AttendanceModel.employees(params);
      set({ employees: (res.data as any)?.data?.employees ?? [], loadingEmployees: false });
    } catch (err) {
      set({ loadingEmployees: false });
    }
  },

  loadDashboard: async (date) => {
    set({ loadingDashboard: true });
    try {
      const res = await AttendanceModel.dashboard(date);
      set({ dashboard: (res.data as any)?.data?.dashboard ?? null, loadingDashboard: false });
    } catch (err) {
      set({ loadingDashboard: false });
    }
  },

  loadSchedules: async () => {
    try {
      const res = await WorkScheduleModel.getAll();
      set({ schedules: (res.data as any)?.data?.schedules ?? [] });
    } catch (err) {
      // ignore — schedules are optional to display
    }
  },

  saveSchedule: async (data) => {
    await WorkScheduleModel.upsert(data);
    await get().loadSchedules();
  },

  loadLeaves: async (status) => {
    try {
      const res = await LeaveRequestModel.list((status || '') as never);
      set({ leaves: (res.data as any)?.data?.leaves ?? [] });
    } catch (err) {
      // ignore
    }
  },

  createLeave: async (data) => {
    await LeaveRequestModel.create(data);
    await get().loadLeaves();
  },

  approveLeave: async (id) => {
    await LeaveRequestModel.approve(id);
    await get().loadLeaves();
  },

  rejectLeave: async (id) => {
    await LeaveRequestModel.reject(id);
    await get().loadLeaves();
  },

  loadHolidays: async () => {
    try {
      const res = await HolidayModel.list();
      set({ holidays: (res.data as any)?.data?.holidays ?? [] });
    } catch (err) {
      // ignore
    }
  },

  createHoliday: async (data) => {
    await HolidayModel.create(data);
    await get().loadHolidays();
  },

  deleteHoliday: async (id) => {
    await HolidayModel.remove(id);
    await get().loadHolidays();
  },

  loadOvertime: async () => {
    try {
      const res = await OvertimeModel.list();
      set({ overtime: (res.data as any)?.data?.overtime ?? [] });
    } catch (err) {
      // ignore — the overtime panel is optional to display
    }
  },

  requestOvertime: async (data) => {
    await OvertimeModel.create(data);
    await get().loadOvertime();
  },

  approveOvertime: async (id) => {
    await OvertimeModel.approve(id);
    await get().loadOvertime();
  },

  rejectOvertime: async (id) => {
    await OvertimeModel.reject(id);
    await get().loadOvertime();
  },

  handleAttendanceEvent: (type) => {
    // A clock/status/break change happened (this user or someone else in the
    // company). Refresh the employee's today card and the manager dashboard —
    // both are cheap reads.
    if (type === 'attendance:clocked_in' || type === 'attendance:clocked_out') {
      void get().loadToday();
    }
    if (type === 'attendance:status_changed' || type === 'attendance:clocked_in' || type === 'attendance:clocked_out') {
      void get().loadDashboard();
      void get().loadEmployees({
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
      });
    }
    if (type === 'attendance:break_started' || type === 'attendance:break_ended') {
      void get().loadDashboard();
    }
  },
}));