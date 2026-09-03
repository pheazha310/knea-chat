import type { NextFunction, Request, Response } from 'express';
import type { AttendanceService } from '../services/Attendance.service';

export class AttendanceController {
  constructor(private attendanceService: AttendanceService) {}

  clockIn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const record = await this.attendanceService.clockIn(req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Clocked in successfully',
        data: { record: this.serialize(record) },
      });
    } catch (error) {
      next(error);
    }
  };

  clockOut = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const record = await this.attendanceService.clockOut(req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Clocked out successfully',
        data: { record: this.serialize(record) },
      });
    } catch (error) {
      next(error);
    }
  };

  breakStart = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.attendanceService.startBreak(req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Break started',
        data: { breakId: result.breakId, startedAt: result.startedAt.toISOString() },
      });
    } catch (error) {
      next(error);
    }
  };

  breakEnd = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.attendanceService.endBreak(req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Break ended',
        data: { breakId: result.breakId, durationMinutes: result.durationMinutes },
      });
    } catch (error) {
      next(error);
    }
  };

  meToday = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const day = await this.attendanceService.getToday(req.user!.id);
      res.status(200).json({ success: true, data: { day } });
    } catch (error) {
      next(error);
    }
  };

  meMonth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { year, month } = this.parseMonth(req.query.year, req.query.month);
      const result = await this.attendanceService.getMonth(req.user!.id, year, month);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  employees = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { year, month } = this.parseMonth(req.query.year, req.query.month);
      const departmentId = req.query.department_id ? Number(req.query.department_id) : undefined;
      const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
      const rows = await this.attendanceService.getEmployees(req.user!.companyId, {
        year,
        month,
        departmentId,
        status,
      });
      res.status(200).json({ success: true, data: { employees: rows } });
    } catch (error) {
      next(error);
    }
  };

  employeeDetail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { year, month } = this.parseMonth(req.query.year, req.query.month);
      const result = await this.attendanceService.getEmployeeDetail(
        req.user!.companyId,
        Number(req.params.id),
        year,
        month,
      );
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  report = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { year, month } = this.parseMonth(req.query.year, req.query.month);
      const report = await this.attendanceService.getReport(req.user!.companyId, year, month);
      res.status(200).json({ success: true, data: { report } });
    } catch (error) {
      next(error);
    }
  };

  overtimeRequest = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { date, minutes, reason } = req.body;
      if (!date || minutes === undefined) {
        res.status(400).json({ success: false, message: 'date and minutes are required', errors: {} });
        return;
      }
      const overtime = await this.attendanceService.requestOvertime(req.user!.id, { date, minutes, reason });
      res.status(201).json({ success: true, message: 'Overtime request submitted', data: { overtime } });
    } catch (error) {
      next(error);
    }
  };

  overtimeList = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isManager = ['manager', 'admin', 'super_admin'].includes(req.user!.role);
      const overtime = await this.attendanceService.listOvertime(
        req.user!.companyId,
        req.user!.id,
        isManager,
      );
      res.status(200).json({ success: true, data: { overtime } });
    } catch (error) {
      next(error);
    }
  };

  overtimeApprove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const overtime = await this.attendanceService.setOvertimeStatus(Number(req.params.id), 'approved', req.user!.id);
      res.status(200).json({ success: true, message: 'Overtime approved', data: { overtime } });
    } catch (error) {
      next(error);
    }
  };

  overtimeReject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const overtime = await this.attendanceService.setOvertimeStatus(Number(req.params.id), 'rejected', req.user!.id);
      res.status(200).json({ success: true, message: 'Overtime rejected', data: { overtime } });
    } catch (error) {
      next(error);
    }
  };

  dashboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : undefined;
      const dashboard = await this.attendanceService.getDashboard(req.user!.companyId, date);
      res.status(200).json({ success: true, data: { dashboard } });
    } catch (error) {
      next(error);
    }
  };

  private parseMonth(yearQ: unknown, monthQ: unknown): { year: number; month: number } {
    const now = new Date();
    const year = yearQ ? Number(yearQ) : now.getFullYear();
    const month = monthQ ? Number(monthQ) : now.getMonth() + 1;
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      throw Object.assign(new Error('Invalid month'), { statusCode: 400 });
    }
    return { year, month };
  }

  private serialize(record: unknown): Record<string, unknown> {
    return record as Record<string, unknown>;
  }
}