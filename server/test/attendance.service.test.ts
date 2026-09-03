'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { redisClient } from '../src/cache/redisClient';
import { AttendanceService } from '../src/services/Attendance.service';
import { WorkScheduleService } from '../src/services/WorkSchedule.service';
import { LeaveService } from '../src/services/Leave.service';
import { HolidayService } from '../src/services/Holiday.service';
import type { AttendanceRepository } from '../src/repositories/attendanceRepository';
import type { WorkScheduleRepository } from '../src/repositories/workScheduleRepository';
import type { LeaveRequestRepository } from '../src/repositories/leaveRequestRepository';
import type { HolidayRepository } from '../src/repositories/holidayRepository';
import type { UserRepository } from '../src/repositories/userRepository';

// ---------------------------------------------------------------------------
// In-memory stubs (repositories are constructor-injected, so no DB needed)
// ---------------------------------------------------------------------------

const USER = {
  id: 1,
  company_id: 1,
  first_name: 'Sophea',
  last_name: 'Test',
  is_active: 1,
  role: 'employee',
  department_id: null,
};

const makeUserRepo = (users: Array<Record<string, any>> = [{ ...USER }]) => ({
  findById: async (id: number) => users.find((u) => u.id === id) || null,
  findAll: async () => users.slice(),
});

/** n active company employees (ids 1..n). */
const makeUsers = (n: number): Array<Record<string, any>> =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    company_id: 1,
    first_name: `U${i + 1}`,
    last_name: 'Test',
    is_active: 1,
    role: 'employee',
    department_id: null,
  }));

const makeScheduleRepo = () => {
  let nextId = 1;
  const store: Array<Record<string, any>> = [];
  return {
    store,
    findByEmployee: async (employeeId: number) =>
      store.filter((r) => r.employee_id === employeeId).sort((a, b) => a.day_of_week - b.day_of_week),
    findById: async (id: number) => store.find((r) => r.id === id) || null,
    findByEmployeeAndDay: async (employeeId: number, dow: number) =>
      store.find((r) => r.employee_id === employeeId && r.day_of_week === dow) || null,
    findAllByCompany: async () => store.map((r) => ({ ...r })),
    create: async (data: Record<string, any>) => {
      const id = nextId++;
      store.push({ id, created_at: new Date(), updated_at: new Date(), ...data });
      return id;
    },
    createMany: async (rows: Array<Record<string, any>>) => {
      for (const row of rows) {
        const id = nextId++;
        store.push({ id, created_at: new Date(), updated_at: new Date(), ...row });
      }
    },
    update: async (id: number, data: Record<string, any>) => {
      const row = store.find((r) => r.id === id);
      if (!row) return false;
      Object.assign(row, data);
      return true;
    },
    delete: async (id: number) => {
      const i = store.findIndex((r) => r.id === id);
      if (i < 0) return false;
      store.splice(i, 1);
      return true;
    },
  };
};

const makeAttendanceRepo = () => {
  let nextId = 1;
  let nextBreakId = 1;
  const records: Array<Record<string, any>> = [];
  const breaks: Array<Record<string, any>> = [];
  return {
    records,
    breaks,
    findByEmployeeAndDate: async (employeeId: number, date: string) =>
      records.find((r) => r.employee_id === employeeId && r.date === date) || null,
    findById: async (id: number) => records.find((r) => r.id === id) || null,
    findByEmployeeBetween: async () => records.slice(),
    findByCompanyBetween: async () => records.slice(),
    create: async (data: Record<string, any>) => {
      const id = nextId++;
      records.push({
        id,
        late_minutes: 0,
        early_leave_minutes: 0,
        overtime_minutes: 0,
        status: 'absent',
        clock_in: null,
        clock_out: null,
        total_work_minutes: null,
        created_at: new Date(),
        updated_at: new Date(),
        ...data,
      });
      return id;
    },
    update: async (id: number, data: Record<string, any>) => {
      const row = records.find((r) => r.id === id);
      if (!row) return false;
      Object.assign(row, data);
      return true;
    },
    createBreak: async (attendanceId: number, breakStart: Date) => {
      const id = nextBreakId++;
      breaks.push({ id, attendance_id: attendanceId, break_start: breakStart, break_end: null, duration_minutes: 0 });
      return id;
    },
    findRunningBreak: async (attendanceId: number) =>
      breaks.find((b) => b.attendance_id === attendanceId && b.break_end === null) || null,
    endBreak: async (id: number, breakEnd: Date, durationMinutes: number) => {
      const b = breaks.find((x) => x.id === id);
      if (!b) return false;
      b.break_end = breakEnd;
      b.duration_minutes = durationMinutes;
      return true;
    },
    findBreaksByAttendance: async (attendanceId: number) => breaks.filter((b) => b.attendance_id === attendanceId),
    totalBreakMinutes: async (attendanceId: number) =>
      breaks.filter((b) => b.attendance_id === attendanceId).reduce((sum, b) => sum + (b.duration_minutes || 0), 0),
    findDepartmentNames: async () => [],
    findMissingForDate: async () => [],
    createOvertime: async () => 1,
    findOvertimeByEmployeeAndDate: async () => [],
  };
};

const makeHolidayRepo = (holiday: Record<string, any> | null = null) => ({
  findAll: async () => (holiday ? [holiday] : []),
  findBetween: async () => (holiday ? [holiday] : []),
  findByDate: async (date: string) => (holiday && holiday.date === date ? holiday : null),
  findById: async () => holiday,
  create: async (data: Record<string, any>) => {
    holiday = { id: 1, created_at: new Date(), updated_at: new Date(), ...data };
    return 1;
  },
  update: async () => true,
  delete: async () => true,
});

const makeLeaveRepo = (leaves: Array<Record<string, any>> = []) => ({
  leaves,
  create: async (data: Record<string, any>) => {
    const id = leaves.length + 1;
    leaves.push({ id, status: 'pending', approved_by: null, created_at: new Date(), updated_at: new Date(), ...data });
    return id;
  },
  findById: async (id: number) => leaves.find((l) => l.id === id) || null,
  findByEmployee: async () => leaves.slice(),
  findByCompany: async () => leaves.slice(),
  findApprovedOverlap: async () => leaves.filter((l) => l.status === 'approved'),
  findOverlap: async () => leaves.filter((l) => l.status !== 'rejected'),
  setStatus: async (id: number, status: string, approvedBy: number) => {
    const l = leaves.find((x) => x.id === id);
    if (!l) return false;
    l.status = status;
    l.approved_by = approvedBy;
    return true;
  },
});

interface AttendanceContext {
  service: AttendanceService;
  attendanceRepo: ReturnType<typeof makeAttendanceRepo>;
  scheduleRepo: ReturnType<typeof makeScheduleRepo>;
  userRepo: ReturnType<typeof makeUserRepo>;
  holidayRepo: ReturnType<typeof makeHolidayRepo>;
  leaveRepo: ReturnType<typeof makeLeaveRepo>;
  workScheduleService: WorkScheduleService;
}

// The dashboard reads are cached for 10s (Redis or in-memory fallback); clear
// the keys the dashboard tests use so back-to-back runs stay deterministic.
beforeEach(async () => {
  await redisClient.del('attendance:dashboard:1:2026-09-03');
});

const makeAttendanceContext = (opts: {
  holiday?: Record<string, any> | null;
  leaves?: Array<Record<string, any>>;
  users?: Array<Record<string, any>>;
} = {}): AttendanceContext => {
  const attendanceRepo = makeAttendanceRepo();
  const scheduleRepo = makeScheduleRepo();
  const userRepo = makeUserRepo(opts.users ?? [{ ...USER }]);
  const holidayRepo = makeHolidayRepo(opts.holiday ?? null);
  const leaveRepo = makeLeaveRepo(opts.leaves ?? []);
  const workScheduleService = new WorkScheduleService(
    scheduleRepo as unknown as WorkScheduleRepository,
    userRepo as unknown as UserRepository,
  );
  const service = new AttendanceService(
    attendanceRepo as unknown as AttendanceRepository,
    workScheduleService,
    scheduleRepo as unknown as WorkScheduleRepository,
    holidayRepo as unknown as HolidayRepository,
    leaveRepo as unknown as LeaveRequestRepository,
    userRepo as unknown as UserRepository,
    { publish: () => {} },
  );
  return { service, attendanceRepo, scheduleRepo, userRepo, holidayRepo, leaveRepo, workScheduleService };
};

// ---------------------------------------------------------------------------
// WorkScheduleService — defaults + customization
// ---------------------------------------------------------------------------

describe('WorkScheduleService', () => {
  it('materializes the default Mon–Fri 08:00–17:00 / 480-minute schedule on first read', async () => {
    const scheduleRepo = makeScheduleRepo();
    const svc = new WorkScheduleService(scheduleRepo as unknown as WorkScheduleRepository, makeUserRepo() as unknown as UserRepository);
    const rows = await svc.getForEmployee(1);
    assert.equal(rows.length, 7);

    const monday = rows.find((r) => r.day_of_week === 1)!;
    assert.equal(monday.start_time, '08:00');
    assert.equal(monday.end_time, '17:00');
    assert.equal(monday.break_minutes, 60);
    assert.equal(monday.required_work_minutes, 480);
    assert.equal(monday.is_working_day, 1);

    const sunday = rows.find((r) => r.day_of_week === 0)!;
    assert.equal(sunday.is_working_day, 0);
    assert.equal(sunday.start_time, null);
    assert.equal(sunday.required_work_minutes, 0);
  });

  it('keeps an employee schedule customizable per weekday (e.g. 09:00–18:00)', async () => {
    const scheduleRepo = makeScheduleRepo();
    const svc = new WorkScheduleService(scheduleRepo as unknown as WorkScheduleRepository, makeUserRepo() as unknown as UserRepository);
    await svc.ensureSchedule(1);
    const updated = await svc.upsert({
      employee_id: 1,
      day_of_week: 1,
      start_time: '09:00',
      end_time: '18:00',
      break_minutes: 60,
      required_work_minutes: 480,
      is_working_day: 1,
    });
    assert.equal(updated.start_time, '09:00');
    assert.equal(updated.end_time, '18:00');

    const monday = (await svc.getForEmployee(1)).find((r) => r.day_of_week === 1)!;
    assert.equal(monday.start_time, '09:00');
    // Other days are untouched by the Monday edit.
    const tuesday = (await svc.getForEmployee(1)).find((r) => r.day_of_week === 2)!;
    assert.equal(tuesday.start_time, '08:00');
  });

  it('rejects a working day whose start is not earlier than its end', async () => {
    const scheduleRepo = makeScheduleRepo();
    const svc = new WorkScheduleService(scheduleRepo as unknown as WorkScheduleRepository, makeUserRepo() as unknown as UserRepository);
    await assert.rejects(
      svc.upsert({
        employee_id: 1,
        day_of_week: 1,
        start_time: '17:00',
        end_time: '08:00',
        break_minutes: 60,
        required_work_minutes: 480,
        is_working_day: 1,
      }),
      /start_time must be earlier than end_time/,
    );
  });
});

// ---------------------------------------------------------------------------
// AttendanceService — clock in
// ---------------------------------------------------------------------------

describe('AttendanceService.clockIn', () => {
  it('clocks in on time (08:00) and marks the day present', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T08:00:00') }); // Wednesday
    const { service } = makeAttendanceContext();
    const record = await service.clockIn(1);
    assert.ok(record.clock_in);
    assert.equal(record.late_minutes, 0);
    assert.equal(record.status, 'present');
    assert.equal(record.required_work_minutes, 480);
    assert.equal(record.scheduled_start, '08:00');
  });

  it('computes late minutes from the scheduled start when clocking in after 08:00', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T08:15:00') }); // Wednesday
    const { service } = makeAttendanceContext();
    const record = await service.clockIn(1);
    assert.equal(record.late_minutes, 15);
    assert.equal(record.status, 'late');
  });

  it('rejects clock-in on a day off (Saturday)', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-05T09:00:00') }); // Saturday
    const { service } = makeAttendanceContext();
    await assert.rejects(service.clockIn(1), /Today is a day off/);
  });

  it('rejects clock-in on a public holiday', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T08:00:00') });
    const { service } = makeAttendanceContext({
      holiday: { id: 1, name: 'Test Holiday', date: '2026-09-02', description: null },
    });
    await assert.rejects(service.clockIn(1), /public holiday/);
  });

  it('rejects clock-in while on approved leave', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T08:00:00') });
    const { service } = makeAttendanceContext({
      leaves: [{
        id: 1,
        employee_id: 1,
        leave_type: 'annual',
        start_date: '2026-09-01',
        end_date: '2026-09-10',
        status: 'approved',
      }],
    });
    await assert.rejects(service.clockIn(1), /approved leave/);
  });

  it('prevents a second clock-in on the same day', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T08:00:00') });
    const { service } = makeAttendanceContext();
    await service.clockIn(1);
    await assert.rejects(service.clockIn(1), /already clocked in today/);
  });
});

// ---------------------------------------------------------------------------
// AttendanceService — clock out
// ---------------------------------------------------------------------------

describe('AttendanceService.clockOut', () => {
  it('rejects clock-out without a clock-in', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T17:00:00') });
    const { service } = makeAttendanceContext();
    await assert.rejects(service.clockOut(1), /clock in before clocking out/);
  });

  it('rejects a second clock-out on the same day', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T08:00:00') });
    const { service } = makeAttendanceContext();
    await service.clockIn(1);
    t.mock.timers.setTime(Date.parse('2026-09-02T17:00:00'));
    await service.clockOut(1);
    await assert.rejects(service.clockOut(1), /already clocked out today/);
  });

  it('computes a full 08:00–17:00 day as exactly 480 minutes, present, no overtime', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T08:00:00') });
    const { service } = makeAttendanceContext();
    await service.clockIn(1);
    t.mock.timers.setTime(Date.parse('2026-09-02T17:00:00'));
    const record = await service.clockOut(1);
    assert.equal(record.total_work_minutes, 480);
    assert.equal(record.late_minutes, 0);
    assert.equal(record.early_leave_minutes, 0);
    assert.equal(record.overtime_minutes, 0);
    assert.equal(record.status, 'present');
  });

  it('flags late + early leave + under-time for an 08:15–16:45 day (450 minutes)', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T08:15:00') });
    const { service } = makeAttendanceContext();
    await service.clockIn(1);
    t.mock.timers.setTime(Date.parse('2026-09-02T16:45:00'));
    const record = await service.clockOut(1);
    assert.equal(record.total_work_minutes, 450);
    assert.equal(record.late_minutes, 15);
    assert.equal(record.early_leave_minutes, 15);
    assert.equal(record.overtime_minutes, 0);
    assert.equal(record.status, 'late');
  });

  it('computes 90 minutes of overtime for an 08:00–18:30 day', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T08:00:00') });
    const { service } = makeAttendanceContext();
    await service.clockIn(1);
    t.mock.timers.setTime(Date.parse('2026-09-02T18:30:00'));
    const record = await service.clockOut(1);
    assert.equal(record.total_work_minutes, 570);
    assert.equal(record.overtime_minutes, 90);
    assert.equal(record.late_minutes, 0);
    assert.equal(record.early_leave_minutes, 0);
    assert.equal(record.status, 'overtime');
  });

  it('blocks clock-out while a break is running', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T08:00:00') });
    const { service } = makeAttendanceContext();
    await service.clockIn(1);
    await service.startBreak(1);
    await assert.rejects(service.clockOut(1), /running break/);
  });
});

// ---------------------------------------------------------------------------
// AttendanceService — break lifecycle
// ---------------------------------------------------------------------------

describe('AttendanceService breaks', () => {
  it('records a break duration between start and end', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T08:00:00') });
    const { service } = makeAttendanceContext();
    await service.clockIn(1);
    const { breakId } = await service.startBreak(1);
    t.mock.timers.setTime(Date.parse('2026-09-02T12:30:00'));
    const ended = await service.endBreak(1);
    assert.equal(ended.breakId, breakId);
    assert.equal(ended.durationMinutes, 270);
  });

  it('rejects starting a second break while one is running', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T08:00:00') });
    const { service } = makeAttendanceContext();
    await service.clockIn(1);
    await service.startBreak(1);
    await assert.rejects(service.startBreak(1), /running break/);
  });

  it('rejects ending a break when none is running', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T08:00:00') });
    const { service } = makeAttendanceContext();
    await service.clockIn(1);
    await assert.rejects(service.endBreak(1), /No running break/);
  });
});

// ---------------------------------------------------------------------------
// AttendanceService — today / month calendar reads
// ---------------------------------------------------------------------------

describe('AttendanceService.getToday', () => {
  it('reports a day off with zero required minutes on Saturday', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-05T10:00:00') }); // Saturday
    const { service } = makeAttendanceContext();
    const day = await service.getToday(1);
    assert.equal(day.status, 'day_off');
    assert.equal(day.required_work_minutes, 0);
    assert.equal(day.is_working_day, false);
  });

  it('reports approved leave overriding the working day', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T10:00:00') });
    const { service } = makeAttendanceContext({
      leaves: [{
        id: 1,
        employee_id: 1,
        leave_type: 'sick',
        start_date: '2026-09-01',
        end_date: '2026-09-05',
        status: 'approved',
      }],
    });
    const day = await service.getToday(1);
    assert.equal(day.status, 'leave');
  });

  it('reports a holiday with zero required minutes', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T10:00:00') });
    const { service } = makeAttendanceContext({
      holiday: { id: 1, name: 'Pchum Ben', date: '2026-09-02', description: null },
    });
    const day = await service.getToday(1);
    assert.equal(day.status, 'holiday');
    assert.equal(day.holiday_name, 'Pchum Ben');
    assert.equal(day.required_work_minutes, 0);
  });
});

describe('AttendanceService.getMonth (September 2026)', () => {
  it('builds 30 days with the default Mon–Fri schedule and rolls up the summary', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T10:00:00') });
    const { service, attendanceRepo } = makeAttendanceContext({
      holiday: { id: 1, name: 'Test Holiday', date: '2026-09-07', description: null },
      leaves: [{
        id: 1,
        employee_id: 1,
        leave_type: 'annual',
        start_date: '2026-09-14',
        end_date: '2026-09-15',
        status: 'approved',
      }],
    });
    // Wednesday 2026-09-02: clocked in late, left early, under time.
    attendanceRepo.records.push({
      id: 1,
      employee_id: 1,
      date: '2026-09-02',
      scheduled_start: '08:00',
      scheduled_end: '17:00',
      required_work_minutes: 480,
      clock_in: new Date('2026-09-02T08:15:00'),
      clock_out: new Date('2026-09-02T16:45:00'),
      total_work_minutes: 450,
      late_minutes: 15,
      early_leave_minutes: 15,
      overtime_minutes: 0,
      status: 'late',
      created_at: new Date(),
      updated_at: new Date(),
    });

    const { days, summary } = await service.getMonth(1, 2026, 9);
    assert.equal(days.length, 30);

    // 2026-09-02 is a working day with a 'late' record.
    const sep2 = days.find((d) => d.date === '2026-09-02')!;
    assert.equal(sep2.status, 'late');
    assert.equal(sep2.late_minutes, 15);
    assert.equal(sep2.total_work_minutes, 450);
    assert.equal(sep2.under_time_minutes, 30);

    // 2026-09-05 is a Saturday → day off; 2026-09-07 is the holiday;
    // 2026-09-14/15 are approved leave; 2026-09-01 (before today) is absent.
    assert.equal(days.find((d) => d.date === '2026-09-05')!.status, 'day_off');
    assert.equal(days.find((d) => d.date === '2026-09-07')!.status, 'holiday');
    assert.equal(days.find((d) => d.date === '2026-09-14')!.status, 'leave');
    assert.equal(days.find((d) => d.date === '2026-09-01')!.status, 'absent');

    // Summary: 22 Mon–Fri days − 1 holiday − 2 leave = 19 working days.
    assert.equal(summary.year, 2026);
    assert.equal(summary.month, 9);
    assert.equal(summary.working_days, 19);
    assert.equal(summary.late, 1);
    assert.equal(summary.absent, 1);
    assert.equal(summary.leave, 2);
    assert.equal(summary.day_off, 8);
    assert.equal(summary.holidays, 1);
    // Required: 19 working days × 480 + 2 leave days × 480.
    assert.equal(summary.required_minutes, 21 * 480);
    assert.equal(summary.actual_minutes, 450);
    assert.equal(summary.under_time_minutes, 30);
    assert.equal(summary.overtime_minutes, 0);
    // (19 − 1 absent) / 19 = 94.7%
    assert.equal(summary.attendance_rate, 94.7);
  });
});

// ---------------------------------------------------------------------------
// LeaveService
// ---------------------------------------------------------------------------

describe('LeaveService', () => {
  it('rejects an unknown leave type', async () => {
    const leaveRepo = makeLeaveRepo();
    const svc = new LeaveService(leaveRepo as unknown as LeaveRequestRepository, makeUserRepo() as unknown as UserRepository);
    await assert.rejects(
      svc.create({ employee_id: 1, leave_type: 'sabbatical' as any, start_date: '2026-10-01', end_date: '2026-10-02' }),
      /Invalid leave type/,
    );
  });

  it('rejects malformed or inverted dates', async () => {
    const leaveRepo = makeLeaveRepo();
    const svc = new LeaveService(leaveRepo as unknown as LeaveRequestRepository, makeUserRepo() as unknown as UserRepository);
    await assert.rejects(
      svc.create({ employee_id: 1, leave_type: 'annual', start_date: '01/10/2026', end_date: '2026-10-02' }),
      /YYYY-MM-DD/,
    );
    await assert.rejects(
      svc.create({ employee_id: 1, leave_type: 'annual', start_date: '2026-10-05', end_date: '2026-10-02' }),
      /start_date must be on or before end_date/,
    );
  });

  it('rejects a request overlapping an existing pending/approved one', async () => {
    const leaveRepo = makeLeaveRepo([
      { id: 1, employee_id: 1, leave_type: 'annual', start_date: '2026-10-01', end_date: '2026-10-05', status: 'pending' },
    ]);
    const svc = new LeaveService(leaveRepo as unknown as LeaveRequestRepository, makeUserRepo() as unknown as UserRepository);
    await assert.rejects(
      svc.create({ employee_id: 1, leave_type: 'sick', start_date: '2026-10-04', end_date: '2026-10-08' }),
      /overlapping/,
    );
  });

  it('creates a valid leave request', async () => {
    const leaveRepo = makeLeaveRepo();
    const svc = new LeaveService(leaveRepo as unknown as LeaveRequestRepository, makeUserRepo() as unknown as UserRepository);
    const created = await svc.create({ employee_id: 1, leave_type: 'annual', start_date: '2026-10-10', end_date: '2026-10-11', reason: 'Family trip' });
    assert.equal(created.status, 'pending');
    assert.equal(created.leave_type, 'annual');
  });

  it('only allows approve/reject on pending requests', async () => {
    const leaveRepo = makeLeaveRepo([
      { id: 1, employee_id: 1, leave_type: 'annual', start_date: '2026-10-01', end_date: '2026-10-02', status: 'approved', approved_by: null },
    ]);
    const svc = new LeaveService(leaveRepo as unknown as LeaveRequestRepository, makeUserRepo() as unknown as UserRepository);
    await assert.rejects(svc.setStatus(1, 'approved', 2), /Only pending requests/);
  });

  it('approves a pending request and records the approver', async () => {
    const leaveRepo = makeLeaveRepo([
      { id: 1, employee_id: 1, leave_type: 'annual', start_date: '2026-10-01', end_date: '2026-10-02', status: 'pending', approved_by: null },
    ]);
    const svc = new LeaveService(leaveRepo as unknown as LeaveRequestRepository, makeUserRepo() as unknown as UserRepository);
    const updated = await svc.setStatus(1, 'approved', 9);
    assert.equal(updated.status, 'approved');
    assert.equal(updated.approved_by, 9);
  });
});

// ---------------------------------------------------------------------------
// AttendanceService — manager dashboard (getDashboard)
// ---------------------------------------------------------------------------

describe('AttendanceService.getDashboard (Thursday 2026-09-03)', () => {
  it('rolls up present / late / on-leave / day-off / not-started / working / on-break', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-03T14:00:00') });
    const ctx = makeAttendanceContext({
      users: makeUsers(6),
      leaves: [{
        id: 1,
        employee_id: 5,
        leave_type: 'annual',
        start_date: '2026-09-01',
        end_date: '2026-09-30',
        status: 'approved',
      }],
    });
    // user 1: late (clocked in 08:15), still working
    // user 2: present, still working
    // user 3: present, on a running break
    // user 4: no record yet (not started)
    // user 5: approved leave
    // user 6: Thursday is a day off
    ctx.attendanceRepo.records.push(
      {
        id: 10, employee_id: 1, date: '2026-09-03', scheduled_start: '08:00', scheduled_end: '17:00',
        required_work_minutes: 480, clock_in: new Date('2026-09-03T08:15:00'), clock_out: null,
        total_work_minutes: null, late_minutes: 15, early_leave_minutes: 0, overtime_minutes: 0,
        status: 'late', created_at: new Date(), updated_at: new Date(),
      },
      {
        id: 20, employee_id: 2, date: '2026-09-03', scheduled_start: '08:00', scheduled_end: '17:00',
        required_work_minutes: 480, clock_in: new Date('2026-09-03T08:00:00'), clock_out: null,
        total_work_minutes: null, late_minutes: 0, early_leave_minutes: 0, overtime_minutes: 0,
        status: 'present', created_at: new Date(), updated_at: new Date(),
      },
      {
        id: 30, employee_id: 3, date: '2026-09-03', scheduled_start: '08:00', scheduled_end: '17:00',
        required_work_minutes: 480, clock_in: new Date('2026-09-03T08:00:00'), clock_out: null,
        total_work_minutes: null, late_minutes: 0, early_leave_minutes: 0, overtime_minutes: 0,
        status: 'present', created_at: new Date(), updated_at: new Date(),
      },
    );
    ctx.attendanceRepo.breaks.push({
      id: 1, attendance_id: 30, break_start: new Date('2026-09-03T12:00:00'), break_end: null, duration_minutes: 0,
    });
    // user 6's Thursday is a day off.
    await ctx.workScheduleService.upsert({
      employee_id: 6, day_of_week: 4, start_time: null, end_time: null,
      break_minutes: 60, required_work_minutes: 0, is_working_day: 0,
    });

    const dash = await ctx.service.getDashboard(1);
    assert.equal(dash.date, '2026-09-03');
    assert.equal(dash.total_employees, 6);
    assert.equal(dash.present, 2);
    assert.equal(dash.late, 1);
    assert.equal(dash.absent, 0);
    assert.equal(dash.on_leave, 1);
    assert.equal(dash.day_off, 1);
    assert.equal(dash.holiday, 0);
    assert.equal(dash.not_started, 1);
    assert.equal(dash.currently_working, 3);
    assert.equal(dash.on_break, 1);
  });

  it('marks every employee as holiday when the date is a public holiday', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-03T10:00:00') });
    const ctx = makeAttendanceContext({
      users: makeUsers(3),
      holiday: { id: 1, name: 'Test Holiday', date: '2026-09-03', description: null },
    });
    const dash = await ctx.service.getDashboard(1);
    assert.equal(dash.holiday, 3);
    assert.equal(dash.present, 0);
    assert.equal(dash.late, 0);
    assert.equal(dash.on_leave, 0);
    assert.equal(dash.not_started, 0);
  });
});

// ---------------------------------------------------------------------------
// AttendanceService — employee×day table & monthly report
// ---------------------------------------------------------------------------

describe('AttendanceService.getEmployees / getReport (September 2026)', () => {
  it('builds the employee×day table with per-day statuses and a roll-up summary', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T10:00:00') });
    const ctx = makeAttendanceContext({ users: makeUsers(2) });
    ctx.attendanceRepo.records.push({
      id: 1,
      employee_id: 1,
      date: '2026-09-02',
      scheduled_start: '08:00',
      scheduled_end: '17:00',
      required_work_minutes: 480,
      clock_in: new Date('2026-09-02T08:15:00'),
      clock_out: new Date('2026-09-02T16:45:00'),
      total_work_minutes: 450,
      late_minutes: 15,
      early_leave_minutes: 15,
      overtime_minutes: 0,
      status: 'late',
      created_at: new Date(),
      updated_at: new Date(),
    });

    const rows = await ctx.service.getEmployees(1, { year: 2026, month: 9 });
    assert.equal(rows.length, 2);

    const u1 = rows.find((r) => r.employee_id === 1)!;
    assert.equal(u1.days.length, 30);
    assert.equal(u1.days[0].status, 'absent'); // Sept 1 (before today, no record)
    assert.equal(u1.days[1].status, 'late'); // Sept 2 (record)
    assert.equal(u1.days[1].late_minutes, 15);
    assert.equal(u1.summary.working_days, 22);
    assert.equal(u1.summary.late, 1);
    assert.equal(u1.summary.absent, 1);
    assert.equal(u1.summary.attendance_rate, 95.5); // (22−1)/22

    const u2 = rows.find((r) => r.employee_id === 2)!;
    assert.equal(u2.days[1].status, 'not_started'); // today, no record yet
    assert.equal(u2.summary.present, 0);
    assert.equal(u2.summary.absent, 1);

    // Status filter keeps only employees with a matching day.
    const lateOnly = await ctx.service.getEmployees(1, { year: 2026, month: 9, status: 'late' });
    assert.equal(lateOnly.length, 1);
    assert.equal(lateOnly[0].employee_id, 1);
  });

  it('getReport returns one summary row per employee', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-02T10:00:00') });
    const ctx = makeAttendanceContext({ users: makeUsers(2) });
    ctx.attendanceRepo.records.push({
      id: 1,
      employee_id: 1,
      date: '2026-09-02',
      scheduled_start: '08:00',
      scheduled_end: '17:00',
      required_work_minutes: 480,
      clock_in: new Date('2026-09-02T08:00:00'),
      clock_out: new Date('2026-09-02T17:00:00'),
      total_work_minutes: 480,
      late_minutes: 0,
      early_leave_minutes: 0,
      overtime_minutes: 0,
      status: 'present',
      created_at: new Date(),
      updated_at: new Date(),
    });

    const report = await ctx.service.getReport(1, 2026, 9);
    assert.equal(report.length, 2);
    const u1 = report.find((r) => r.employee_id === 1)!;
    assert.equal(u1.first_name, 'U1');
    assert.equal(u1.department_name, null);
    assert.equal(u1.present, 1);
    assert.equal(u1.actual_minutes, 480);
    assert.equal(u1.attendance_rate, 95.5);
  });
});

// ---------------------------------------------------------------------------
// HolidayService
// ---------------------------------------------------------------------------

describe('HolidayService', () => {
  it('rejects a blank name and a malformed date', async () => {
    const holidayRepo = makeHolidayRepo();
    const svc = new HolidayService(holidayRepo as unknown as HolidayRepository);
    await assert.rejects(svc.create({ name: '   ', date: '2026-10-10' }), /name is required/);
    await assert.rejects(svc.create({ name: 'Pchum Ben', date: '10/10/2026' }), /YYYY-MM-DD/);
  });

  it('rejects a duplicate holiday date', async () => {
    const holidayRepo = makeHolidayRepo({ id: 1, name: 'Existing', date: '2026-10-10', description: null });
    const svc = new HolidayService(holidayRepo as unknown as HolidayRepository);
    await assert.rejects(svc.create({ name: 'Pchum Ben', date: '2026-10-10' }), /already exists/);
  });

  it('creates a holiday', async () => {
    const holidayRepo = makeHolidayRepo();
    const svc = new HolidayService(holidayRepo as unknown as HolidayRepository);
    const created = await svc.create({ name: 'Pchum Ben', date: '2026-10-10', description: 'Water festival' });
    assert.equal(created.name, 'Pchum Ben');
    assert.equal(created.date, '2026-10-10');
  });
});