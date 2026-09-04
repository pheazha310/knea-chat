/**
 * AuditLogService — the audit trail (Company Admin + Super Admin).
 *
 * Administrative actions (user/role/department/team/announcement/company/
 * settings changes) are recorded here so both consoles can answer "who did
 * what, when". `log` is deliberately best-effort: a failed insert must never
 * break the action that produced it.
 */
import type { AuditLogRepository } from '../repositories/auditLogRepository';
import type { AuditLogFilters, AuditLogRow, CreateAuditLogData } from '../types';

export class AuditLogService {
  constructor(private auditLogRepository: AuditLogRepository) {}

  /** Record one entry. Never throws — audit failures are logged, not fatal. */
  async log(data: CreateAuditLogData): Promise<void> {
    try {
      await this.auditLogRepository.create(data);
    } catch (error) {
      console.error('[AuditLog] Failed to record audit entry:', (error as Error).message);
    }
  }

  /** A company's own trail (Company Admin console). */
  async listForCompany(companyId: number, filters: AuditLogFilters = {}): Promise<AuditLogRow[]> {
    return this.auditLogRepository.findByCompany(companyId, filters);
  }

  /** Everything on the platform — every company plus platform-scope actions. */
  async listPlatform(filters: AuditLogFilters = {}): Promise<AuditLogRow[]> {
    return this.auditLogRepository.findByPlatform(filters);
  }

  /** Platform-scope actions only (no company). */
  async listPlatformOnly(filters: AuditLogFilters = {}): Promise<AuditLogRow[]> {
    return this.auditLogRepository.findPlatformOnly(filters);
  }
}
