import { Router } from 'express';
import type { CompanyController } from '../controllers/company.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createCompanyRouter = (companyController: CompanyController, auth: AuthMiddleware): Router => {
  const router = Router();

  // Every route below is platform-level and reserved for super admins
  // (Super Admin: manage organizations and administrators).

  router.get('/', auth.authenticate, auth.authorizeAtLeast('super_admin'), companyController.list);
  router.get('/:id', auth.authenticate, auth.authorizeAtLeast('super_admin'), companyController.getById);
  router.post('/', auth.authenticate, auth.authorizeAtLeast('super_admin'), companyController.create);
  router.patch('/:id', auth.authenticate, auth.authorizeAtLeast('super_admin'), companyController.update);
  router.delete('/:id', auth.authenticate, auth.authorizeAtLeast('super_admin'), companyController.remove);

  /** Users of an organization, optionally filtered by role (e.g. ?role=admin). */
  router.get('/:id/users', auth.authenticate, auth.authorizeAtLeast('super_admin'), companyController.getUsers);

  /** Convenience endpoint: the administrators of an organization. */
  router.get('/:id/admins', auth.authenticate, auth.authorizeAtLeast('super_admin'), companyController.getAdmins);

  return router;
};
