/**
 * DepartmentController — MVC controller layer.
 *
 * Handles HTTP requests for department management and delegates business
 * logic to DepartmentService. All departments are scoped to the requester's
 * company; create/update/delete are admin+ (enforced on the routes).
 */
import type { NextFunction, Request, Response } from 'express';
import type { DepartmentService } from '../services/Department.service';

export class DepartmentController {
  constructor(private departmentService: DepartmentService) {}

  /** GET /api/departments */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const departments = await this.departmentService.getDepartments(
        req.user!.companyId,
      );
      res.status(200).json({
        success: true,
        message: 'Departments retrieved successfully',
        data: { departments },
      });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/departments/:id */
  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const department = await this.departmentService.getDepartment(
        Number(req.params.id),
      );
      res.status(200).json({
        success: true,
        message: 'Department retrieved successfully',
        data: { department },
      });
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/departments */
  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, description } = req.body;

      if (!name) {
        res.status(400).json({
          success: false,
          message: 'Department name is required',
          errors: { name: 'Name is required' },
        });
        return;
      }

      const department = await this.departmentService.createDepartment({
        company_id: req.user!.companyId,
        name,
        description,
      });

      res.status(201).json({
        success: true,
        message: 'Department created successfully',
        data: { department },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** PATCH /api/departments/:id */
  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const departmentId = Number(req.params.id);
      const { name, description } = req.body;

      const department = await this.departmentService.updateDepartment(departmentId, {
        name,
        description,
      });

      res.status(200).json({
        success: true,
        message: 'Department updated successfully',
        data: { department },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/departments/:id */
  remove = async (req: Request, res: Response): Promise<void> => {
    try {
      const departmentId = Number(req.params.id);
      const result = await this.departmentService.deleteDepartment(departmentId);
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
}
