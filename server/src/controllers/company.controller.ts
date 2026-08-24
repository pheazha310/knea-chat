/**
 * CompanyController — MVC controller layer.
 *
 * Handles platform-level HTTP requests for organizations (companies) and
 * delegates business logic to CompanyService. Every route is reserved for
 * the platform Super Admin.
 */
import type { NextFunction, Request, Response } from 'express';
import type { CompanyService } from '../services/Company.service';

export class CompanyController {
  constructor(private companyService: CompanyService) {}

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
