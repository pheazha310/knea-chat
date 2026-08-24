/**
 * DepartmentRepository — data-access layer for the `departments` table.
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { DepartmentRow } from '../types';

export class DepartmentRepository {
  constructor(private db: Db) {}

  async findAll(companyId: number): Promise<DepartmentRow[]> {
    return this.db.query<DepartmentRow[]>(
      `SELECT d.*,
              (SELECT COUNT(*) FROM users WHERE department_id = d.id) as user_count
       FROM departments d
       WHERE d.company_id = ?
       ORDER BY d.name ASC`,
      [companyId],
    );
  }

  async findById(id: number): Promise<DepartmentRow | null> {
    const departments = await this.db.query<DepartmentRow[]>(
      'SELECT * FROM departments WHERE id = ?',
      [id],
    );
    return departments[0] || null;
  }

  async create(data: {
    company_id: number;
    name: string;
    description?: string | null;
  }): Promise<number> {
    const { company_id, name, description } = data;
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO departments (company_id, name, description) VALUES (?, ?, ?)',
      [company_id, name, description || null],
    );
    return result.insertId;
  }

  async update(id: number, data: Record<string, unknown>): Promise<boolean> {
    const allowed = ['name', 'description'];
    const updates: string[] = [];
    const params: unknown[] = [];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key]);
      }
    }

    if (!updates.length) return false;

    params.push(id);
    const result = await this.db.query<ResultSetHeader>(
      `UPDATE departments SET ${updates.join(', ')} WHERE id = ?`,
      params,
    );
    return result.affectedRows > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'DELETE FROM departments WHERE id = ?',
      [id],
    );
    return result.affectedRows > 0;
  }

  /** Number of users assigned to a department (deletion guard). */
  async countUsers(departmentId: number): Promise<number> {
    const [row] = await this.db.query<Array<{ count: number }>>(
      'SELECT COUNT(*) as count FROM users WHERE department_id = ?',
      [departmentId],
    );
    return parseInt(String(row.count));
  }
}
