/**
 * CompanyService — business logic for organizations (platform-level, used by
 * the Super Admin console).
 */
import type { CompanyRepository } from '../repositories/companyRepository';
import type { CompanyRow } from '../types';

export class CompanyService {
  constructor(private companyRepository: CompanyRepository) {}

  async getCompanies(filters: { search?: string } = {}): Promise<{ companies: CompanyRow[] }> {
    const companies = await this.companyRepository.findAll(filters);
    return { companies };
  }

  async getCompany(id: number): Promise<CompanyRow> {
    const company = await this.companyRepository.findById(id);
    if (!company) {
      throw new Error('Organization not found');
    }
    return company;
  }

  async createCompany(data: { name: string; domain?: string | null; logo?: string | null }): Promise<CompanyRow> {
    const { name, domain, logo } = data;

    if (!name) {
      throw new Error('Organization name is required');
    }

    if (domain) {
      const existing = await this.companyRepository.findByDomain(domain);
      if (existing) {
        throw new Error('An organization with this domain already exists');
      }
    }

    const companyId = await this.companyRepository.create({ name, domain, logo });
    const company = await this.companyRepository.findById(companyId);
    if (!company) throw new Error('Organization not found');
    return company;
  }

  async updateCompany(id: number, data: { name?: string; domain?: string | null; logo?: string | null }): Promise<CompanyRow> {
    const company = await this.companyRepository.findById(id);
    if (!company) {
      throw new Error('Organization not found');
    }

    if (data.domain) {
      const existing = await this.companyRepository.findByDomain(data.domain);
      if (existing && Number(existing.id) !== Number(id)) {
        throw new Error('An organization with this domain already exists');
      }
    }

    const updated = await this.companyRepository.update(id, data);
    if (!updated) {
      throw new Error('Failed to update organization');
    }

    const refreshed = await this.companyRepository.findById(id);
    if (!refreshed) throw new Error('Organization not found');
    return refreshed;
  }

  async deleteCompany(id: number): Promise<{ message: string }> {
    const company = await this.companyRepository.findById(id);
    if (!company) {
      throw new Error('Organization not found');
    }

    const dependents = await this.companyRepository.countDependents(id);
    if (dependents.users > 0 || dependents.teams > 0 || dependents.channels > 0) {
      throw new Error(
        `Cannot delete an organization that still has data ` +
          `(${dependents.users} users, ${dependents.teams} teams, ${dependents.channels} channels). ` +
          'Remove or migrate its data first.',
      );
    }

    const deleted = await this.companyRepository.delete(id);
    if (!deleted) {
      throw new Error('Failed to delete organization');
    }

    return { message: 'Organization deleted successfully' };
  }

  async getCompanyUsers(companyId: number, role = ''): Promise<unknown[]> {
    await this.companyRepository.findById(companyId);
    return this.companyRepository.findUsers(companyId, role);
  }
}
