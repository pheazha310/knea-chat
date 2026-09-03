/// <reference types="jest" />
import api from '../services/api';
import { useAttendanceStore } from './attendanceStore';

jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;

const makeDay = (overrides: Record<string, unknown> = {}) => ({
  date: '2026-09-02',
  day_of_week: 3,
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
  ...overrides,
});

const makeSummary = (overrides: Record<string, unknown> = {}) => ({
  year: 2026,
  month: 9,
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
  ...overrides,
});

const RESET_STATE = {
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
};

beforeEach(() => {
  jest.clearAllMocks();
  useAttendanceStore.setState(RESET_STATE);
});

describe('attendanceStore — employee self view', () => {
  test('loadToday stores the today card from GET /attendance/me/today', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { success: true, data: { day: makeDay() } },
    } as any);

    await useAttendanceStore.getState().loadToday();

    expect(mockedApi.get).toHaveBeenCalledWith('/attendance/me/today');
    expect(useAttendanceStore.getState().today?.date).toBe('2026-09-02');
    expect(useAttendanceStore.getState().today?.required_work_minutes).toBe(480);
  });

  test('loadToday surfaces the server error message', async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { message: 'Could not load today' } },
    });

    await useAttendanceStore.getState().loadToday();

    expect(useAttendanceStore.getState().today).toBeNull();
    expect(useAttendanceStore.getState().todayError).toBe('Could not load today');
  });

  test('loadMonth stores days and the monthly summary', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: { days: [makeDay()], summary: makeSummary() },
      },
    } as any);

    await useAttendanceStore.getState().loadMonth(2026, 9);

    expect(mockedApi.get).toHaveBeenCalledWith('/attendance/me/month?year=2026&month=9');
    expect(useAttendanceStore.getState().monthDays).toHaveLength(1);
    expect(useAttendanceStore.getState().monthSummary?.attendance_rate).toBe(86.4);
  });

  test('clockIn POSTs and then refreshes today + the month', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { success: true, message: 'Clocked in successfully', data: { record: { id: 1 } } },
    } as any);
    mockedApi.get.mockImplementation((url: unknown) => {
      if (String(url).includes('/me/month')) {
        return Promise.resolve({
          data: { success: true, data: { days: [], summary: makeSummary() } },
        });
      }
      return Promise.resolve({
        data: { success: true, data: { day: makeDay({ clock_in: '2026-09-02T08:03:00' }) } },
      });
    });

    await useAttendanceStore.getState().clockIn();

    expect(mockedApi.post).toHaveBeenCalledWith('/attendance/clock-in', {});
    expect(useAttendanceStore.getState().today?.clock_in).toBe('2026-09-02T08:03:00');
    expect(useAttendanceStore.getState().monthSummary).not.toBeNull();
  });

  test('clockIn stores the rejection message and rethrows', async () => {
    mockedApi.post.mockRejectedValueOnce({
      response: { data: { message: 'You have already clocked in today' } },
    });

    await expect(useAttendanceStore.getState().clockIn()).rejects.toBeTruthy();

    expect(useAttendanceStore.getState().todayError).toBe('You have already clocked in today');
  });
});

describe('attendanceStore — manager view', () => {
  test('loadDashboard stores the dashboard', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: { dashboard: { date: '2026-09-03', total_employees: 5, present: 3, late: 1, currently_working: 3, on_break: 1 } },
      },
    } as any);

    await useAttendanceStore.getState().loadDashboard('2026-09-03');

    expect(mockedApi.get).toHaveBeenCalledWith('/attendance/dashboard?date=2026-09-03');
    expect(useAttendanceStore.getState().dashboard?.total_employees).toBe(5);
    expect(useAttendanceStore.getState().dashboard?.currently_working).toBe(3);
  });

  test('loadEmployees stores the employee×day rows', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: { employees: [{ employee_id: 1, first_name: 'Maya', last_name: 'Test', days: [] }] },
      },
    } as any);

    await useAttendanceStore.getState().loadEmployees({ year: 2026, month: 9 });

    expect(mockedApi.get).toHaveBeenCalledWith('/attendance/employees?year=2026&month=9');
    expect(useAttendanceStore.getState().employees).toHaveLength(1);
    expect(useAttendanceStore.getState().employees[0].employee_id).toBe(1);
  });

  test('loadEmployees forwards department and status filters', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: { employees: [] } } } as any);

    await useAttendanceStore.getState().loadEmployees({ year: 2026, month: 9, department_id: 2, status: 'late' });

    expect(mockedApi.get).toHaveBeenCalledWith(
      '/attendance/employees?year=2026&month=9&department_id=2&status=late',
    );
  });
});

describe('attendanceStore — overtime', () => {
  test('requestOvertime POSTs and reloads the list', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { success: true, message: 'Overtime request submitted', data: { overtime: { id: 1 } } },
    } as any);
    mockedApi.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: { overtime: [{ id: 1, date: '2026-09-02', minutes: 90, status: 'pending' }] },
      },
    } as any);

    await useAttendanceStore.getState().requestOvertime({ date: '2026-09-02', minutes: 90 });

    expect(mockedApi.post).toHaveBeenCalledWith('/overtime', { date: '2026-09-02', minutes: 90 });
    expect(useAttendanceStore.getState().overtime).toHaveLength(1);
    expect(useAttendanceStore.getState().overtime[0].status).toBe('pending');
  });

  test('approveOvertime PUTs and reloads the list', async () => {
    mockedApi.put.mockResolvedValueOnce({
      data: { success: true, message: 'Overtime approved', data: { overtime: { id: 1, status: 'approved' } } },
    } as any);
    mockedApi.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: { overtime: [{ id: 1, date: '2026-09-02', minutes: 90, status: 'approved' }] },
      },
    } as any);

    await useAttendanceStore.getState().approveOvertime(1);

    expect(mockedApi.put).toHaveBeenCalledWith('/overtime/1/approve', {});
    expect(useAttendanceStore.getState().overtime[0].status).toBe('approved');
  });

  test('rejectOvertime PUTs and reloads the list', async () => {
    mockedApi.put.mockResolvedValueOnce({ data: { success: true } } as any);
    mockedApi.get.mockResolvedValueOnce({
      data: { success: true, data: { overtime: [] } },
    } as any);

    await useAttendanceStore.getState().rejectOvertime(7);

    expect(mockedApi.put).toHaveBeenCalledWith('/overtime/7/reject', {});
    expect(useAttendanceStore.getState().overtime).toHaveLength(0);
  });
});

describe('attendanceStore — WebSocket event handling', () => {
  test('a clocked_in event refreshes the today card, dashboard and employee table', async () => {
    mockedApi.get.mockImplementation((url: unknown) => {
      if (String(url).includes('/me/month')) {
        return Promise.resolve({ data: { success: true, data: { days: [], summary: makeSummary() } } });
      }
      if (String(url).includes('/dashboard')) {
        return Promise.resolve({ data: { success: true, data: { dashboard: { date: '2026-09-03', total_employees: 5 } } } });
      }
      if (String(url).includes('/employees')) {
        return Promise.resolve({ data: { success: true, data: { employees: [{ employee_id: 1 }] } } });
      }
      return Promise.resolve({ data: { success: true, data: { day: makeDay({ clock_in: 'x' }) } } });
    });

    useAttendanceStore.getState().handleAttendanceEvent('attendance:clocked_in');
    // The handler fires void refreshes — flush the microtask queue.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useAttendanceStore.getState().today?.clock_in).toBe('x');
    expect(useAttendanceStore.getState().dashboard?.total_employees).toBe(5);
    expect(useAttendanceStore.getState().employees).toHaveLength(1);
  });

  test('a break_started event refreshes the dashboard only', async () => {
    mockedApi.get.mockImplementation((url: unknown) => {
      if (String(url).includes('/dashboard')) {
        return Promise.resolve({ data: { success: true, data: { dashboard: { on_break: 1 } } } });
      }
      return Promise.resolve({ data: { success: true, data: {} } });
    });

    useAttendanceStore.getState().handleAttendanceEvent('attendance:break_started');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useAttendanceStore.getState().dashboard?.on_break).toBe(1);
  });
});