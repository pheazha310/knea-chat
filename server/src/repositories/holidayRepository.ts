/**
 * HolidayRepository — data access for the `holidays` table.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { CreateHolidayData, HolidayRow, UpdateHolidayData } from '../types';

export class HolidayRepository {
  constructor(private db: Db) {}

  /** Project DATE columns back to 'YYYY-MM-DD' strings (TZ-safe). */
  private static SELECT = `h.id, h.name, DATE_FORMAT(h.date, '%Y-%m-%d') AS date,
    h.description, h.created_at, h.updated_at`;

  async findAll(): Promise<HolidayRow[]> {
    return this.db.query<HolidayRow[]>(
      `SELECT ${HolidayRepository.SELECT} FROM holidays h ORDER BY h.date ASC`,
    );
  }

  async findBetween(startDate: string, endDate: string): Promise<HolidayRow[]> {
    return this.db.query<HolidayRow[]>(
      `SELECT ${HolidayRepository.SELECT} FROM holidays h
       WHERE h.date BETWEEN ? AND ? ORDER BY h.date ASC`,
      [startDate, endDate],
    );
  }

  async findByDate(date: string): Promise<HolidayRow | null> {
    const rows = await this.db.query<HolidayRow[]>(
      `SELECT ${HolidayRepository.SELECT} FROM holidays h WHERE h.date = ?`,
      [date],
    );
    return rows[0] || null;
  }

  async findById(id: number): Promise<HolidayRow | null> {
    const rows = await this.db.query<HolidayRow[]>(
      `SELECT ${HolidayRepository.SELECT} FROM holidays h WHERE h.id = ?`,
      [id],
    );
    return rows[0] || null;
  }

  async create(data: CreateHolidayData): Promise<number> {
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO holidays (name, date, description) VALUES (?, ?, ?)',
      [data.name, data.date, data.description ?? null],
    );
    return result.insertId;
  }

  async update(id: number, data: UpdateHolidayData): Promise<boolean> {
    const updates: string[] = [];
    const params: unknown[] = [];
    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.date !== undefined) {
      updates.push('date = ?');
      params.push(data.date);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      params.push(data.description);
    }
    if (updates.length === 0) return false;
    params.push(id);
    const result = await this.db.query<ResultSetHeader>(
      `UPDATE holidays SET ${updates.join(', ')} WHERE id = ?`,
      params,
    );
    return result.affectedRows > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'DELETE FROM holidays WHERE id = ?',
      [id],
    );
    return result.affectedRows > 0;
  }
}