import { Router } from 'express';
import type { SearchController } from '../controllers/search.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createSearchRouter = (searchController: SearchController, auth: AuthMiddleware): Router => {
  const router = Router();

  router.get('/messages', auth.authenticate, searchController.searchMessages);
  router.get('/users', auth.authenticate, searchController.searchUsers);

  return router;
};
