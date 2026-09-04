import { Router } from 'express';
import type { TeamController } from '../controllers/team.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createTeamRouter = (teamController: TeamController, auth: AuthMiddleware): Router => {
  const router = Router();

  router.get('/', auth.authenticate, teamController.list);
  // Creating / deleting teams consults the discretionary permission catalog
  // (Company Admins may restrict managers); baseline = manager+.
  router.post('/', auth.authenticate, auth.authorizeCapability('create_teams'), teamController.create);
  router.get('/:id', auth.authenticate, teamController.getById);
  router.patch('/:id', auth.authenticate, teamController.update);
  router.delete('/:id', auth.authenticate, auth.authorizeCapability('manage_teams'), teamController.remove);
  router.post('/:id/members', auth.authenticate, teamController.addMember);
  router.delete('/:id/members/:memberId', auth.authenticate, teamController.removeMember);
  router.get('/:id/members', auth.authenticate, teamController.getMembers);

  return router;
};
