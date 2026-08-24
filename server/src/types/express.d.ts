/**
 * Express request augmentation — `authenticate` middleware attaches the
 * decoded JWT payload to `req.user` for every protected route.
 */
import type { AuthUser } from './Auth';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
