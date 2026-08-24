import { Router } from 'express';
import type { DepartmentController } from '../controllers/department.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createDepartmentRouter = (
  departmentController: DepartmentController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  // Any authenticated user of the company may browse departments.
  router.get('/', auth.authenticate, departmentController.list);
  router.get('/:id', auth.authenticate, departmentController.getById);

  // Managing departments is admin+ (company structure, SRS FR-06).
  router.post('/', auth.authenticate, auth.authorizeAtLeast('admin'), departmentController.create);
  router.patch('/:id', auth.authenticate, auth.authorizeAtLeast('admin'), departmentController.update);
  router.delete('/:id', auth.authenticate, auth.authorizeAtLeast('admin'), departmentController.remove);

  return router;
};
