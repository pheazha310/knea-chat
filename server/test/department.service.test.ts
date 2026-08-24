'use strict';

/**
 * DepartmentService — company-scoped department CRUD (SRS FR-06).
 *   - names are trimmed and required
 *   - a department with members cannot be deleted (users.department_id FK)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DepartmentService } from '../src/services/Department.service';
import type { DepartmentRepository } from '../src/repositories/departmentRepository';
import type { DepartmentRow } from '../src/types';

const departmentRepository = {
  findAll: async () => [] as DepartmentRow[],
  findById: async () => null as DepartmentRow | null,
  create: async () => 1,
  update: async () => true,
  delete: async () => true,
  countUsers: async () => 0,
};

const departmentService = new DepartmentService(
  departmentRepository as unknown as DepartmentRepository,
);

const makeDepartment = (overrides: Partial<DepartmentRow> = {}): DepartmentRow => ({
  id: 1,
  company_id: 1,
  name: 'Engineering',
  description: 'Builds the product',
  created_at: '2026-08-12T10:00:00Z',
  updated_at: '2026-08-12T10:00:00Z',
  ...overrides,
});

describe('DepartmentService.createDepartment', () => {
  it('creates a department with the trimmed name', async (t) => {
    t.mock.method(departmentRepository, 'create', async () => 7);
    t.mock.method(departmentRepository, 'findById', async () => makeDepartment({ id: 7, name: 'Design' }));

    const department = await departmentService.createDepartment({
      company_id: 1,
      name: '  Design  ',
      description: 'UX & brand',
    });

    assert.equal(department.id, 7);
    assert.equal(department.name, 'Design');
  });

  it('rejects an empty department name', async (t) => {
    const create = t.mock.method(departmentRepository, 'create', async () => 1);
    await assert.rejects(
      departmentService.createDepartment({ company_id: 1, name: '   ' }),
      /Department name is required/,
    );
    assert.equal(create.mock.calls.length, 0);
  });
});

describe('DepartmentService.updateDepartment', () => {
  it('updates the name and description', async (t) => {
    t.mock.method(departmentRepository, 'findById', async () => makeDepartment());
    const update = t.mock.method(departmentRepository, 'update', async () => true);
    t.mock.method(departmentRepository, 'findById', async () => makeDepartment({ name: 'Platform' }));

    const department = await departmentService.updateDepartment(1, {
      name: 'Platform',
      description: 'Infrastructure',
    });

    assert.deepEqual(update.mock.calls[0].arguments, [1, { name: 'Platform', description: 'Infrastructure' }]);
    assert.equal(department.name, 'Platform');
  });

  it('rejects an empty name on update', async (t) => {
    t.mock.method(departmentRepository, 'findById', async () => makeDepartment());
    const update = t.mock.method(departmentRepository, 'update', async () => true);
    await assert.rejects(
      departmentService.updateDepartment(1, { name: '' }),
      /Department name is required/,
    );
    assert.equal(update.mock.calls.length, 0);
  });

  it('throws when the department does not exist', async (t) => {
    t.mock.method(departmentRepository, 'findById', async () => null);
    await assert.rejects(
      departmentService.updateDepartment(99, { name: 'X' }),
      /Department not found/,
    );
  });
});

describe('DepartmentService.deleteDepartment', () => {
  it('deletes a department with no members', async (t) => {
    t.mock.method(departmentRepository, 'findById', async () => makeDepartment());
    t.mock.method(departmentRepository, 'countUsers', async () => 0);
    const del = t.mock.method(departmentRepository, 'delete', async () => true);

    const result = await departmentService.deleteDepartment(1);

    assert.equal(del.mock.calls.length, 1);
    assert.equal(result.message, 'Department deleted successfully');
  });

  it('refuses to delete a department that still has members', async (t) => {
    t.mock.method(departmentRepository, 'findById', async () => makeDepartment());
    t.mock.method(departmentRepository, 'countUsers', async () => 3);
    const del = t.mock.method(departmentRepository, 'delete', async () => true);

    await assert.rejects(
      departmentService.deleteDepartment(1),
      /Cannot delete "Engineering" — 3 member\(s\) are still assigned/,
    );
    assert.equal(del.mock.calls.length, 0);
  });

  it('throws when the department does not exist', async (t) => {
    t.mock.method(departmentRepository, 'findById', async () => null);
    await assert.rejects(
      departmentService.deleteDepartment(99),
      /Department not found/,
    );
  });
});

describe('DepartmentService.getDepartments', () => {
  it('returns the company departments with user counts', async (t) => {
    const findAll = t.mock.method(departmentRepository, 'findAll', async () => [
      makeDepartment({ id: 1, name: 'Engineering', user_count: 4 }),
      makeDepartment({ id: 2, name: 'Design', user_count: 2 }),
    ]);

    const departments = await departmentService.getDepartments(1);

    assert.equal(findAll.mock.calls.length, 1);
    assert.deepEqual(findAll.mock.calls[0].arguments, [1]);
    assert.equal(departments.length, 2);
    assert.equal(departments[0].user_count, 4);
  });
});
