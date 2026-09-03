import type { NextFunction, Request, Response } from 'express';
import type { LeaveService } from '../services/Leave.service';

export class LeaveRequestController {
  constructor(private leaveService: LeaveService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { leave_type, start_date, end_date, reason } = req.body;
      if (!leave_type || !start_date || !end_date) {
        res.status(400).json({
          success: false,
          message: 'leave_type, start_date and end_date are required',
          errors: {},
        });
        return;
      }
      const leave = await this.leaveService.create({
        employee_id: req.user!.id,
        leave_type,
        start_date,
        end_date,
        reason: reason || undefined,
      });
      res.status(201).json({ success: true, message: 'Leave request submitted', data: { leave } });
    } catch (error) {
      next(error);
    }
  };

  /** Employees see their own requests; managers see everyone's. */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isManager = ['manager', 'admin', 'super_admin'].includes(req.user!.role);
      const status = typeof req.query.status === 'string' ? req.query.status as 'pending' | 'approved' | 'rejected' | '' : '';
      if (isManager) {
        const leaves = await this.leaveService.listAll(req.user!.companyId, status);
        res.status(200).json({ success: true, data: { leaves } });
        return;
      }
      const leaves = await this.leaveService.listForEmployee(req.user!.id);
      res.status(200).json({ success: true, data: { leaves } });
    } catch (error) {
      next(error);
    }
  };

  approve = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const leave = await this.leaveService.setStatus(Number(req.params.id), 'approved', req.user!.id);
      res.status(200).json({ success: true, message: 'Leave approved', data: { leave } });
    } catch (error) {
      next(error);
    }
  };

  reject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const leave = await this.leaveService.setStatus(Number(req.params.id), 'rejected', req.user!.id);
      res.status(200).json({ success: true, message: 'Leave rejected', data: { leave } });
    } catch (error) {
      next(error);
    }
  };
}