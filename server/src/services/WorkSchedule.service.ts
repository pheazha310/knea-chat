/**
 * WorkScheduleService — per-employee weekly schedule management.
 *
 * Defaults (Mon–Fri 08:00–17:00, 60 min break, 480 required minutes, Sat/Sun
 * off) are materialized lazily on first read so every employee has a row per
 * weekday while managers can still customize any employee's schedule.
 */
import type { WorkScheduleRepository } from '../repositories/workScheduleRepository';
import type { UserRepository } from '../repositories/userRepository';
import { badRequest } from '../utils/errors.utils';
import type {
  CreateWorkScheduleData,
  UpdateWorkScheduleData,
  WorkScheduleRow,
} from '../types';

export interface DefaultScheduleDay {
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  required_work_minutes: number;
  is_working_day: number;
}

/** Default schedule: Monday–Friday 08:00–17:00 with a 60-minute break. */
export const DEFAULT_SCHEDULE: DefaultScheduleDay[] = [
  { day_of_week: 0, start_time: null, end_time: null, break_minutes: 60, required_work_minutes: 0, is_working_day: 0 },
  { day_of_week: 1, start_time: '08:00', end_time: '17:00', break_minutes: 60, required_work_minutes: 480, is_working_day: 1 },
  { day_of_week: 2, start_time: '08:00', end_time: '17:00', break_minutes: 60, required_work_minutes: 480, is_working_day: 1 },
  { day_of_week: 3, start_time: '08:00', end_time: '17:00', break_minutes: 60, required_work_minutes: 480, is_working_day: 1 },
  { day_of_week: 4, start_time: '08:00', end_time: '17:00', break_minutes: 60, required_work_minutes: 480, is_working_day: 1 },
  { day_of_week: 5, start_time: '08:00', end_time: '17:00', break_minutes: 60, required_work_minutes: 480, is_working_day: 1 },
  { day_of_week: 6, start_time: null, end_time: null, break_minutes: 60, required_work_minutes: 0, is_working_day: 0 },
];

export class WorkScheduleService {
  constructor(
    private workScheduleRepository: WorkScheduleRepository,
    private userRepository: UserRepository,
  ) {}

  /** Materialize the default weekly schedule for an employee (no-op if they
   *  already have any rows). Returns the stored rows. */
  async ensureSchedule(employeeId: number): Promise<WorkScheduleRow[]> {
    const existing = await this.workScheduleRepository.findByEmployee(employeeId);
    if (existing.length > 0) return existing;

    await this.workScheduleRepository.createMany(
      DEFAULT_SCHEDULE.map((day) => ({
        employee_id: employeeId,
        ...day,
      })),
    );
    return this.workScheduleRepository.findByEmployee(employeeId);
  }

  /** Schedule for a specific weekday (defaults materialized on demand). */
  async getForWeekday(employeeId: number, dayOfWeek: number): Promise<WorkScheduleRow> {
    const rows = await this.ensureSchedule(employeeId);
    const row = rows.find((r) => r.day_of_week === dayOfWeek);
    if (row) return row;
    // Extremely unlikely (created in ensureSchedule) — fall back to defaults.
    const fallback = DEFAULT_SCHEDULE.find((d) => d.day_of_week === dayOfWeek)!;
    return {
      id: 0,
      employee_id: employeeId,
      day_of_week: dayOfWeek,
      start_time: fallback.start_time,
      end_time: fallback.end_time,
      break_minutes: fallback.break_minutes,
      required_work_minutes: fallback.required_work_minutes,
      is_working_day: fallback.is_working_day,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  /** Full weekly schedule for one employee. */
  async getForEmployee(employeeId: number): Promise<WorkScheduleRow[]> {
    return this.ensureSchedule(employeeId);
  }

  /** Every schedule in the manager's company, joined to employee names. */
  async getAll(companyId: number): Promise<Array<WorkScheduleRow & { first_name?: string; last_name?: string }>> {
    return this.workScheduleRepository.findAllByCompany(companyId);
  }

  /** Create or update a single employee-day schedule entry. */
  async upsert(data: CreateWorkScheduleData): Promise<WorkScheduleRow> {
    const user = await this.userRepository.findById(data.employee_id);
    if (!user)    throw badRequest('Employee not found');

    if (data.day_of_week < 0 || data.day_of_week > 6) {
      throw badRequest('day_of_week must be between 0 (Sunday) and 6 (Saturday)');
    }

    const existing = await this.workScheduleRepository.findByEmployeeAndDay(
      data.employee_id,
      data.day_of_week,
    );

    const isWorking = data.is_working_day ?? (data.start_time && data.end_time ? 1 : 1);
    const start = data.start_time ?? (isWorking ? '08:00' : null);
    const end = data.end_time ?? (isWorking ? '17:00' : null);

    if (isWorking === 1) {
      if (!start || !end)    throw badRequest('Working days require start_time and end_time');
      if (start >= end)    throw badRequest('start_time must be earlier than end_time');
    }

    if (existing) {
      await this.workScheduleRepository.update(existing.id, {
        start_time: data.start_time !== undefined ? data.start_time : (isWorking ? start : null),
        end_time: data.end_time !== undefined ? data.end_time : (isWorking ? end : null),
        break_minutes: data.break_minutes,
        required_work_minutes: data.required_work_minutes,
        is_working_day: data.is_working_day,
      });
      const updated = await this.workScheduleRepository.findById(existing.id);
      if (!updated)    throw badRequest('Schedule not found');
      return updated;
    }

    await this.workScheduleRepository.create({
      employee_id: data.employee_id,
      day_of_week: data.day_of_week,
      start_time: start,
      end_time: end,
      break_minutes: data.break_minutes ?? 60,
      required_work_minutes: data.required_work_minutes ?? 480,
      is_working_day: isWorking,
    });
    const created = await this.workScheduleRepository.findByEmployeeAndDay(
      data.employee_id,
      data.day_of_week,
    );
    if (!created)    throw badRequest('Schedule not found');
    return created;
  }

  async update(id: number, data: UpdateWorkScheduleData): Promise<WorkScheduleRow> {
    const existing = await this.workScheduleRepository.findById(id);
    if (!existing)    throw badRequest('Schedule entry not found');

    const isWorking = data.is_working_day !== undefined
      ? data.is_working_day
      : existing.is_working_day;
    const start = data.start_time !== undefined ? data.start_time : existing.start_time;
    const end = data.end_time !== undefined ? data.end_time : existing.end_time;

    if (isWorking === 1) {
      if (!start || !end)    throw badRequest('Working days require start_time and end_time');
      if (start >= end)    throw badRequest('start_time must be earlier than end_time');
    }

    await this.workScheduleRepository.update(id, data);
    const updated = await this.workScheduleRepository.findById(id);
    if (!updated)    throw badRequest('Schedule entry not found');
    return updated;
  }

  async remove(id: number): Promise<boolean> {
    const existing = await this.workScheduleRepository.findById(id);
    if (!existing)    throw badRequest('Schedule entry not found');
    return this.workScheduleRepository.delete(id);
  }
}