import { Router } from 'express';
import type { ChannelController } from '../controllers/channel.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createChannelRouter = (channelController: ChannelController, auth: AuthMiddleware): Router => {
  const router = Router();

  router.get('/', auth.authenticate, channelController.list);
  // Channel creation is enforced in ChannelService.assertCanCreateChannel
  // (managers+ anywhere they may; employees inside teams they belong to).
  router.post('/', auth.authenticate, channelController.create);
  router.get('/:id', auth.authenticate, channelController.getById);
  router.patch('/:id', auth.authenticate, channelController.update);
  router.delete('/:id', auth.authenticate, auth.authorizeAtLeast('manager'), channelController.remove);
  router.post('/:id/members', auth.authenticate, channelController.addMember);
  router.delete('/:id/members/:memberId', auth.authenticate, channelController.removeMember);
  router.get('/:id/members', auth.authenticate, channelController.getMembers);

  return router;
};
