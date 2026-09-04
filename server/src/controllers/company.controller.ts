/**
 * CompanyController — MVC controller layer.
 *
 * Handles platform-level HTTP requests for organizations (companies) and
 * delegates business logic to CompanyService. Every route is reserved for
 * the platform Super Admin.
 */
import type { NextFunction, Request, Response } from 'express';
import type { AuditLogService } from '../services/AuditLog.service';
import type { CompanyService } from '../services/Company.service';

export class CompanyController {
  constructor(
    private companyService: CompanyService,
    private auditLogService?: AuditLogService | null,
  ) {}

  /** Best-effort platform-scope audit record (Super Admin actions). */
  private async record(
    req: Request,
    action: string,
    companyId: number,
    details?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditLogService) return;
    await this.auditLogService.log({
      company_id: null,
      actor_user_id: req.user!.id,
      actor_role: req.user!.role,
      action,
      entity_type: 'company',
      entity_id: companyId,
      details,
      ip_address: req.ip,
    });
  }

  /** GET /api/companies */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { search = '' } = req.query;
      const result = await this.companyService.getCompanies({ search: String(search) });
      res.status(200).json({
        success: true,
        message: 'Organizations retrieved successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/companies/:id */
  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const company = await this.companyService.getCompany(Number(req.params.id));
      res.status(200).json({
        success: true,
        message: 'Organization retrieved successfully',
        data: { company },
      });
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/companies */
  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, domain, logo } = req.body;
      const company = await this.companyService.createCompany({ name, domain, logo });
      await this.record(req, 'company.created', company.id, {
        name: company.name,
        domain: company.domain ?? undefined,
      });
      res.status(201).json({
        success: true,
        message: 'Organization created successfully',
        data: { company },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** PATCH /api/companies/:id */
  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, domain, logo } = req.body;
      const company = await this.companyService.updateCompany(Number(req.params.id), { name, domain, logo });
      await this.record(req, 'company.updated', company.id, {
        name: name !== undefined ? String(name) : undefined,
        domain: domain !== undefined ? String(domain) : undefined,
      });
      res.status(200).json({
        success: true,
        message: 'Organization updated successfully',
        data: { company },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/companies/:id */
  remove = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.companyService.deleteCompany(Number(req.params.id));
      await this.record(req, 'company.deleted', Number(req.params.id));
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/companies/:id/users — optionally filtered by role (e.g. ?role=admin). */
  getUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { role = '' } = req.query;
      const users = await this.companyService.getCompanyUsers(Number(req.params.id), String(role));
      res.status(200).json({
        success: true,
        message: 'Organization users retrieved successfully',
        data: { users },
      });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/companies/:id/admins — convenience endpoint for administrators. */
  getAdmins = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const users = await this.companyService.getCompanyUsers(Number(req.params.id), 'admin');
      res.status(200).json({
        success: true,
        message: 'Organization administrators retrieved successfully',
        data: { admins: users },
      });
    } catch (error) {
      next(error);
    }
  };
}
