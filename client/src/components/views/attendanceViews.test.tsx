/// <reference types="jest" />
import React from 'react';
import { render, screen } from '@testing-library/react';
import AttendanceView from './AttendanceView';
import ManagerAttendanceView from './ManagerAttendanceView';
import { useAttendanceStore } from '../../store/attendanceStore';

jest.mock('../../store/attendanceStore', () => ({
  useAttendanceStore: jest.fn(),
}));

const mockStore = useAttendanceStore as unknown as jest.Mock;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 30 days for the current month, first day marked present. */
const buildMonthDays = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const daysInMonth = new Date(y, m, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, i) => {
    const date = `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
    return {
      date,
      day_of_week: new Date(y, m - 1, i).getDay(),
      is_working_day: true,
      is_day_off: false,
      is_holiday: false,
      scheduled_start: '08:00',
      scheduled_end: '17:00',
      break_minutes: 60,
      required_work_minutes: 480,
      clock_in: null,
      clock_out: null,
      total_work_minutes: null,
      late_minutes: 0,
      early_leave_minutes: 0,
      under_time_minutes: 0,
      overtime_minutes: 0,
      status: null,
    };
  }).map((day, i) =>
    i === 0
      ? { ...day, status: 'present', clock_in: '2026-09-02T08:00:00', clock_out: '2026-09-02T17:00:00', total_work_minutes: 480 }
      : day,
  );
};

const baseStore = () => {
  const monthDays = buildMonthDays();
  const now = new Date();
  return {
    today: {
      ...monthDays[0],
      status: null,
      clock_in: null,
      clock_out: null,
    },
    monthDays,
    monthSummary: {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      working_days: 22,
      present: 19,
      late: 2,
      absent: 1,
      leave: 2,
      day_off: 8,
      holidays: 0,
      required_minutes: 10080,
      actual_minutes: 9570,
      under_time_minutes: 390,
      overtime_minutes: 255,
      attendance_rate: 86.4,
    },
    loadingToday: false,
    loadingMonth: false,
    todayError: null,
    leaves: [],
    holidays: [],
    overtime: [],
    loadToday: jest.fn(),
    loadMonth: jest.fn(),
    clockIn: jest.fn(),
    clockOut: jest.fn(),
    breakStart: jest.fn(),
    breakEnd: jest.fn(),
    loadLeaves: jest.fn(),
    createLeave: jest.fn(),
    loadHolidays: jest.fn(),
    loadOvertime: jest.fn(),
    requestOvertime: jest.fn(),
  };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AttendanceView (employee calendar)', () => {
  test('renders the month title, calendar days, Clock In control and monthly summary', () => {
    mockStore.mockReturnValue(baseStore());

    render(<AttendanceView />);

    const now = new Date();
    expect(
      screen.getByRole('heading', { name: `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}` }),
    ).toBeTruthy();
    // First day of the month is 'present' → green dot rendered in the grid.
    expect(screen.getAllByText('🟢').length).toBeGreaterThan(0);
    // Today card shows the Clock In button (not clocked in yet).
    expect(screen.getByRole('button', { name: /Clock In/ })).toBeTruthy();
    // Monthly summary block with the attendance rate.
    expect(screen.getByText(/Monthly summary/)).toBeTruthy();
    expect(screen.getByText('86.4%')).toBeTruthy();
    // Leave + overtime + holiday sidebar sections.
    expect(screen.getByText('Request leave')).toBeTruthy();
    expect(screen.getByText('Overtime requests')).toBeTruthy();
    expect(screen.getByText('Upcoming holidays')).toBeTruthy();
  });

  test('shows the leave-day badge for approved leave dates', () => {
    const store = baseStore();
    const y = new Date().getFullYear();
    const m = new Date().getMonth() + 1;
    store.leaves = [
      {
        id: 1,
        employee_id: 3,
        leave_type: 'annual',
        start_date: `${y}-${String(m).padStart(2, '0')}-01`,
        end_date: `${y}-${String(m).padStart(2, '0')}-01`,
        reason: null,
        status: 'approved',
        approved_by: null,
      },
    ];
    mockStore.mockReturnValue(store);

    render(<AttendanceView />);

    // Approved leave renders the 🔵 badge on the calendar (multiple due to
    // both the day status and the leave overlay logic).
    expect(screen.getAllByText('🔵').length).toBeGreaterThan(0);
  });
});

describe('ManagerAttendanceView', () => {
  const managerStore = () => ({
    dashboard: {
      date: '2026-09-03',
      total_employees: 5,
      present: 3,
      late: 1,
      absent: 0,
      on_leave: 1,
      day_off: 0,
      holiday: 0,
      not_started: 0,
      currently_working: 3,
      on_break: 0,
    },
    employees: [
      {
        employee_id: 1,
        first_name: 'Maya',
        last_name: 'Test',
        department_id: null,
        department_name: null,
        days: [],
        summary: {
          working_days: 22,
          present: 19,
          late: 2,
          absent: 1,
          leave: 2,
          day_off: 8,
          holidays: 0,
          required_minutes: 10080,
          actual_minutes: 9570,
          under_time_minutes: 390,
          overtime_minutes: 255,
          attendance_rate: 86.4,
        },
      },
    ],
    leaves: [
      {
        id: 1,
        employee_id: 3,
        leave_type: 'annual',
        start_date: '2026-09-28',
        end_date: '2026-09-29',
        reason: null,
        status: 'pending',
        approved_by: null,
        employee_first_name: 'Maya',
        employee_last_name: 'Test',
      },
    ],
    holidays: [],
    overtime: [
      {
        id: 2,
        employee_id: 3,
        date: '2026-09-02',
        attendance_id: null,
        minutes: 90,
        reason: null,
        status: 'pending',
        approved_by: null,
        employee_first_name: 'Maya',
        employee_last_name: 'Test',
      },
    ],
    loadDashboard: jest.fn(),
    loadEmployees: jest.fn(),
    loadSchedules: jest.fn(),
    loadLeaves: jest.fn(),
    loadHolidays: jest.fn(),
    loadOvertime: jest.fn(),
    approveLeave: jest.fn(),
    rejectLeave: jest.fn(),
    createHoliday: jest.fn(),
    deleteHoliday: jest.fn(),
    approveOvertime: jest.fn(),
    rejectOvertime: jest.fn(),
  });

  test('renders the live dashboard, employee table, pending leave and pending overtime', () => {
    mockStore.mockReturnValue(managerStore());

    render(<ManagerAttendanceView />);

    expect(screen.getByText("Today's attendance — 2026-09-03")).toBeTruthy();
    // The employee appears in the table, the pending leave list and the
    // pending overtime list.
    expect(screen.getAllByText('Maya Test').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Pending leave requests/)).toBeTruthy();
    expect(screen.getByText('Pending overtime (1)')).toBeTruthy();
    expect(screen.getByText(/1h 30m/)).toBeTruthy(); // 90 overtime minutes
    // One approve action for the pending leave, one for the pending overtime.
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(2);
  });

  test('renders an empty pending list state when nothing is waiting', () => {
    const store = managerStore();
    store.leaves = [];
    store.overtime = [];
    mockStore.mockReturnValue(store);

    render(<ManagerAttendanceView />);

    expect(screen.getAllByText('Nothing pending.')).toHaveLength(2);
  });
});