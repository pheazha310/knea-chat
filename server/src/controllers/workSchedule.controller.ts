import type { NextFunction, Request, Response } from 'express';
import type { WorkScheduleService } from '../services/WorkSchedule.service';

export class WorkScheduleController {
  constructor(private workScheduleService: WorkScheduleService) {}

  /** All schedules in the company (manager view). */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const schedules = await this.workScheduleService.getAll(req.user!.companyId);
      res.status(200).json({ success: true, data: { schedules } });
    } catch (error) {
      next(error);
    }
  };

  /** One employee's weekly schedule (managers: anyone; employees: self). */
  getByEmployee = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const employeeId = Number(req.params.employeeId);
      if (!Number.isFinite(employeeId)) {
        res.status(400).json({ success: false, message: 'Invalid employee id', errors: {} });
        return;
      }
      const isManager = ['manager', 'admin', 'super_admin'].includes(req.user!.role);
      if (!isManager && Number(req.user!.id) !== employeeId) {
        res.status(403).json({ success: false, message: 'Not allowed to view this schedule', errors: {} });
        return;
      }
      const schedules = await this.workScheduleService.getForEmployee(employeeId);
      res.status(200).json({ success: true, data: { schedules } });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { employee_id, day_of_week, start_time, end_time, break_minutes, required_work_minutes, is_working_day } = req.body;
      if (!employee_id || day_of_week === undefined) {
        res.status(400).json({ success: false, message: 'employee_id and day_of_week are required', errors: {} });
        return;
      }
      const schedule = await this.workScheduleService.upsert({
        employee_id: Number(employee_id),
        day_of_week: Number(day_of_week),
        start_time: start_time ?? null,
        end_time: end_time ?? null,
        break_minutes: break_minutes !== undefined ? Number(break_minutes) : undefined,
        required_work_minutes: required_work_minutes !== undefined ? Number(required_work_minutes) : undefined,
        is_working_day: is_working_day !== undefined ? (is_working_day ? 1 : 0) : undefined,
      });
      res.status(201).json({ success: true, message: 'Schedule saved', data: { schedule } });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Number(req.params.id);
      const { start_time, end_time, break_minutes, required_work_minutes, is_working_day } = req.body;
      const schedule = await this.workScheduleService.update(id, {
        start_time: start_time !== undefined ? start_time : undefined,
        end_time: end_time !== undefined ? end_time : undefined,
        break_minutes: break_minutes !== undefined ? Number(break_minutes) : undefined,
        required_work_minutes: required_work_minutes !== undefined ? Number(required_work_minutes) : undefined,
        is_working_day: is_working_day !== undefined ? (is_working_day ? 1 : 0) : undefined,
      });
      res.status(200).json({ success: true, message: 'Schedule updated', data: { schedule } });
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.workScheduleService.remove(Number(req.params.id));
      res.status(200).json({ success: true, message: 'Schedule deleted' });
    } catch (error) {
      next(error);
    }
  };
}