/**
 * HolidayService — public holiday CRUD. Holidays override normal attendance
 * (the day shows 🎉 with 0 required hours and clock-in is blocked).
 */
import type { HolidayRepository } from '../repositories/holidayRepository';
import type { CreateHolidayData, HolidayRow, UpdateHolidayData } from '../types';
import { badRequest } from '../utils/errors.utils';

export class HolidayService {
  constructor(private holidayRepository: HolidayRepository) {}

  async list(): Promise<HolidayRow[]> {
    return this.holidayRepository.findAll();
  }

  async create(data: CreateHolidayData): Promise<HolidayRow> {
    const name = (data.name || '').trim();
    if (!name)    throw badRequest('Holiday name is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      throw badRequest('Date must use YYYY-MM-DD format');
    }

    const existing = await this.holidayRepository.findByDate(data.date);
    if (existing)    throw badRequest(`A holiday already exists on ${data.date}`);

    const id = await this.holidayRepository.create({ ...data, name });
    const created = await this.holidayRepository.findById(id);
    if (!created)    throw badRequest('Could not create holiday');
    return created;
  }

  async update(id: number, data: UpdateHolidayData): Promise<HolidayRow> {
    const existing = await this.holidayRepository.findById(id);
    if (!existing)    throw badRequest('Holiday not found');

    if (data.date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
        throw badRequest('Date must use YYYY-MM-DD format');
      }
      const dup = await this.holidayRepository.findByDate(data.date);
      if (dup && dup.id !== id)    throw badRequest(`A holiday already exists on ${data.date}`);
    }

    await this.holidayRepository.update(id, data);
    const updated = await this.holidayRepository.findById(id);
    if (!updated)    throw badRequest('Holiday not found');
    return updated;
  }

  async remove(id: number): Promise<boolean> {
    const existing = await this.holidayRepository.findById(id);
    if (!existing)    throw badRequest('Holiday not found');
    return this.holidayRepository.delete(id);
  }
}