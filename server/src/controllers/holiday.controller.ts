import type { NextFunction, Request, Response } from 'express';
import type { HolidayService } from '../services/Holiday.service';

export class HolidayController {
  constructor(private holidayService: HolidayService) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const holidays = await this.holidayService.list();
      res.status(200).json({ success: true, data: { holidays } });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { name, date, description } = req.body;
      if (!name || !date) {
        res.status(400).json({ success: false, message: 'name and date are required', errors: {} });
        return;
      }
      const holiday = await this.holidayService.create({ name, date, description });
      res.status(201).json({ success: true, message: 'Holiday created', data: { holiday } });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { name, date, description } = req.body;
      const holiday = await this.holidayService.update(Number(req.params.id), {
        name,
        date,
        description,
      });
      res.status(200).json({ success: true, message: 'Holiday updated', data: { holiday } });
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.holidayService.remove(Number(req.params.id));
      res.status(200).json({ success: true, message: 'Holiday deleted' });
    } catch (error) {
      next(error);
    }
  };
}