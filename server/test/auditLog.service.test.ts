'use strict';

/**
 * AuditLogService — the audit trail for the Administration module.
 *   - log() records entries and NEVER throws (a broken audit table must not
 *     break the administrative action that produced it)
 *   - company trails and the platform trail are returned with the joined
 *     actor identity
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AuditLogService } from '../src/services/AuditLog.service';
import type { AuditLogRepository } from '../src/repositories/auditLogRepository';
import type { AuditLogRow, CreateAuditLogData } from '../src/types';

const auditLogRepository = {
  create: async (_data: CreateAuditLogData) => 1,
  findByCompany: async () => [] as AuditLogRow[],
  findByPlatform: async () => [] as AuditLogRow[],
  findPlatformOnly: async () => [] as AuditLogRow[],
};

const service = new AuditLogService(auditLogRepository as unknown as AuditLogRepository);

const entry = (overrides: Partial<CreateAuditLogData> = {}): CreateAuditLogData => ({
  company_id: 1,
  actor_user_id: 5,
  actor_role: 'admin',
  action: 'team.created',
  entity_type: 'team',
  entity_id: 12,
  details: { name: 'Product' },
  ip_address: '127.0.0.1',
  ...overrides,
});

describe('AuditLogService.log', () => {
  it('records a company entry through the repository', async (t) => {
    const create = t.mock.method(auditLogRepository, 'create', async () => 1);
    await service.log(entry());
    assert.equal(create.mock.calls.length, 1);
    const arg = create.mock.calls[0].arguments[0] as CreateAuditLogData;
    assert.equal(arg.company_id, 1);
    assert.equal(arg.action, 'team.created');
    assert.equal(arg.entity_type, 'team');
    assert.equal(arg.entity_id, 12);
    assert.deepEqual(arg.details, { name: 'Product' });
  });

  it('records a platform-scope entry when company_id is null', async (t) => {
    const create = t.mock.method(auditLogRepository, 'create', async () => 1);
    await service.log(entry({ company_id: null, action: 'settings.updated', entity_id: null }));
    const arg = create.mock.calls[0].arguments[0] as CreateAuditLogData;
    assert.equal(arg.company_id, null);
  });

  it('never throws when the repository fails', async (t) => {
    t.mock.method(auditLogRepository, 'create', async () => {
      throw new Error('db down');
    });
    await assert.doesNotReject(service.log(entry()));
  });
});

describe('AuditLogService.listForCompany', () => {
  it('passes companyId and filters through to the repository', async (t) => {
    const rows = [
      { id: 1, company_id: 1, actor_user_id: 5, actor_role: 'admin', action: 'team.created', entity_type: 'team', entity_id: 12, details: null, ip_address: null, created_at: '2026-09-01T10:00:00Z' },
    ] as AuditLogRow[];
    const findByCompany = t.mock.method(auditLogRepository, 'findByCompany', async () => rows);

    const result = await service.listForCompany(1, { action: 'team.created', limit: 50 });

    assert.deepEqual(findByCompany.mock.calls[0].arguments, [1, { action: 'team.created', limit: 50 }]);
    assert.equal(result.length, 1);
  });
});

describe('AuditLogService.listPlatform / listPlatformOnly', () => {
  it('delegates to the platform queries', async (t) => {
    const all = t.mock.method(auditLogRepository, 'findByPlatform', async () => []);
    const only = t.mock.method(auditLogRepository, 'findPlatformOnly', async () => []);

    await service.listPlatform({ limit: 25 });
    await service.listPlatformOnly({ limit: 25 });

    assert.equal(all.mock.calls.length, 1);
    assert.equal(only.mock.calls.length, 1);
  });
});
