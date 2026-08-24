/**
 * Authentication Middleware
 * Handles JWT token verification and user authentication. Exported as a
 * factory so the settings service (maintenance-mode check) is injected.
 */
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { isAtLeast } from '../utils/roles';
import type { SystemSettingService } from '../services/SystemSetting.service';
import type { AuthUser } from '../types';

export interface AuthMiddleware {
  authenticate: RequestHandler;
  authorize: (allowedRoles?: string[]) => RequestHandler;
  authorizeAtLeast: (minRole: string) => RequestHandler;
}

const getSecret = (): string => process.env.JWT_SECRET || 'your-secret-key';

/**
 * Create the auth middleware bound to a SystemSettingService instance
 * (used for the platform maintenance-mode check).
 */
export const createAuthMiddleware = (systemSettingService: SystemSettingService): AuthMiddleware => {
  /**
   * Authenticate middleware - verifies JWT token and attaches user to request
   */
  const authenticate: RequestHandler = async (req, res, next) => {
    try {
      // Get token from Authorization header
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        return res.status(401).json({
          success: false,
          message: 'Authorization header is missing',
          errors: {},
        });
      }

      // Extract token from "Bearer <token>"
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : authHeader;

      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Token not provided',
          errors: {},
        });
      }

      // Verify token
      const decoded = jwt.verify(token, getSecret()) as jwt.JwtPayload;

      // Attach user to request
      req.user = {
        id: decoded.id as number,
        email: decoded.email as string,
        role: decoded.role as string,
        companyId: decoded.companyId as number,
      } as AuthUser;

      // Platform maintenance mode: block everyone except the Super Admin.
      // (The login route checks this separately since it is unauthenticated.)
      if (req.user.role !== 'super_admin') {
        const settings = await systemSettingService.getCached();
        if (settings.maintenance_mode) {
          return res.status(503).json({
            success: false,
            message: 'KneaChat is under maintenance. Please try again later.',
            errors: { maintenance: 'Platform maintenance in progress' },
          });
        }
      }

      next();
    } catch (error) {
      const err = error as { name?: string };
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token has expired',
          errors: {},
        });
      }

      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token',
          errors: {},
        });
      }

      return res.status(401).json({
        success: false,
        message: 'Authentication failed',
        errors: { auth: (error as Error).message },
      });
    }
  };

  /**
   * Authorization middleware - checks if user has required role
   */
  const authorize = (allowedRoles: string[] = []): RequestHandler => {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'User not authenticated',
          errors: {},
        });
      }

      if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'User does not have permission to perform this action',
          errors: {},
        });
      }

      next();
    };
  };

  /**
   * Authorization middleware - checks that the user holds at least the given
   * role in the hierarchy (super_admin > admin > manager > employee).
   */
  const authorizeAtLeast = (minRole: string): RequestHandler => {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'User not authenticated',
          errors: {},
        });
      }

      if (!isAtLeast(req.user.role, minRole)) {
        return res.status(403).json({
          success: false,
          message: 'User does not have permission to perform this action',
          errors: {},
        });
      }

      next();
    };
  };

  return { authenticate, authorize, authorizeAtLeast };
};
