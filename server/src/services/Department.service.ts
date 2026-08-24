/**
 * DepartmentService — business logic for departments.
 *
 * Departments are organizational units scoped to a company (SRS FR-06).
 * Listing is open to any authenticated user of the company; creating,
 * updating and deleting are admin+ operations enforced at the route layer.
 */
import type { DepartmentRepository } from '../repositories/departmentRepository';
import type { DepartmentRow } from '../types';

export class DepartmentService {
  constructor(private departmentRepository: DepartmentRepository) {}

  async getDepartments(companyId: number): Promise<DepartmentRow[]> {
    return this.departmentRepository.findAll(companyId);
  }

  async getDepartment(id: number): Promise<DepartmentRow> {
    const department = await this.departmentRepository.findById(id);
    if (!department) {
      throw new Error('Department not found');
    }
    return department;
  }

  async createDepartment(data: {
    company_id: number;
    name: string;
    description?: string | null;
  }): Promise<DepartmentRow> {
    const { company_id, name, description } = data;

    const trimmed = (name || '').trim();
    if (!trimmed) {
      throw new Error('Department name is required');
    }

    const departmentId = await this.departmentRepository.create({
      company_id,
      name: trimmed,
      description,
    });

    const department = await this.departmentRepository.findById(departmentId);
    if (!department) throw new Error('Department not found');
    return department;
  }

  async updateDepartment(
    id: number,
    data: { name?: string; description?: string | null },
  ): Promise<DepartmentRow> {
    const department = await this.departmentRepository.findById(id);
    if (!department) {
      throw new Error('Department not found');
    }

    const payload: Record<string, unknown> = {};
    if (data.name !== undefined) {
      const trimmed = (data.name || '').trim();
      if (!trimmed) {
        throw new Error('Department name is required');
      }
      payload.name = trimmed;
    }
    if (data.description !== undefined) payload.description = data.description;

    const updated = await this.departmentRepository.update(id, payload);
    if (!updated) {
      throw new Error('Failed to update department');
    }

    const refreshed = await this.departmentRepository.findById(id);
    if (!refreshed) throw new Error('Department not found');
    return refreshed;
  }

  /**
   * Delete a department. Departments that still have members are protected —
   * deleting them would orphan users (the `users.department_id` FK has no
   * ON DELETE action), so the caller must reassign members first.
   */
  async deleteDepartment(id: number): Promise<{ message: string }> {
    const department = await this.departmentRepository.findById(id);
    if (!department) {
      throw new Error('Department not found');
    }

    const memberCount = await this.departmentRepository.countUsers(id);
    if (memberCount > 0) {
      throw new Error(
        `Cannot delete "${department.name}" — ${memberCount} member(s) are still assigned. Reassign them first.`,
      );
    }

    const deleted = await this.departmentRepository.delete(id);
    if (!deleted) {
      throw new Error('Failed to delete department');
    }

    return { message: 'Department deleted successfully' };
  }
}
