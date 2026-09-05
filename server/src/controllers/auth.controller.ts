/**
 * AuthController — MVC controller layer.
 *
 * Handles HTTP requests for authentication (register, login, logout, token
 * refresh, password recovery) and delegates business logic to AuthService.
 * The route file only maps URLs to these handlers.
 */
import type { Request, Response, NextFunction } from 'express';
import type { AuthService } from '../services/Auth.service';
import type { UserRepository } from '../repositories/userRepository';
import type { SystemSettingService } from '../services/SystemSetting.service';

export class AuthController {
  constructor(
    private authService: AuthService,
    private userRepository: UserRepository,
    private systemSettingService: SystemSettingService,
  ) {}

  /** POST /api/auth/register */
  register = async (req: Request, res: Response): Promise<void> => {
    try {
      const settings = await this.systemSettingService.getCached();

      if (!settings.allow_public_registration) {
        res.status(403).json({
          success: false,
          message:
            'Public registration is currently disabled. Ask your workspace administrator to create an account for you.',
          errors: { registration: 'Registration closed' },
        });
        return;
      }

      const result = await this.authService.register(
        req.body,
        req.ip || null,
        req.get('user-agent') || null,
        settings,
      );
      res.status(201).json({
        success: true,
        message: 'Account created successfully',
        data: result,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };

  /** POST /api/auth/login */
  login = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({
          success: false,
          message: 'Email and password are required',
          errors: { validation: 'Missing required fields' },
        });
        return;
      }

      // During maintenance only the Super Admin may sign in.
      const settings = await this.systemSettingService.getCached();
      if (settings.maintenance_mode) {
        const user = await this.userRepository.findByEmail(email);
        if (!user || user.role !== 'super_admin') {
          res.status(503).json({
            success: false,
            message: 'KneaChat is under maintenance. Please try again later.',
            errors: { maintenance: 'Platform maintenance in progress' },
          });
          return;
        }
      }

      const result = await this.authService.login(email, password, req.ip || null, req.get('user-agent') || null);

      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: result,
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** POST /api/auth/logout */
  logout = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.authService.logout(req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Logout successful',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Logout failed',
        errors: {},
      });
    }
  };

  /** POST /api/auth/refresh */
  refresh = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.authService.refreshToken(req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Token refreshed',
        data: result,
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** POST /api/auth/forgot-password */
  forgotPassword = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({
          success: false,
          message: 'Email is required',
          errors: { email: 'Email field is required' },
        });
        return;
      }

      const result = await this.authService.forgotPassword(email);
      res.status(200).json({
        success: true,
        message: result.message,
        // Development convenience: until email delivery is configured, return
        // the reset token so the client can offer a direct reset link.
        data: result.resetToken ? { resetToken: result.resetToken } : undefined,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to process password reset request',
        errors: {},
      });
    }
  };

  /** POST /api/auth/reset-password */
  resetPassword = async (req: Request, res: Response): Promise<void> => {
    try {
      const { token, newPassword, confirmPassword } = req.body;

      if (!token || !newPassword || !confirmPassword) {
        res.status(400).json({
          success: false,
          message: 'Token and new password are required',
          errors: { validation: 'Missing required fields' },
        });
        return;
      }

      if (newPassword !== confirmPassword) {
        res.status(400).json({
          success: false,
          message: 'Passwords do not match',
          errors: { password: 'Passwords do not match' },
        });
        return;
      }

      const settings = await this.systemSettingService.getCached();
      if (newPassword.length < settings.password_min_length) {
        res.status(400).json({
          success: false,
          message: `Password must be at least ${settings.password_min_length} characters`,
          errors: { password: 'Password too short' },
        });
        return;
      }

      const result = await this.authService.resetPassword(token, newPassword);
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

  /** POST /api/auth/change-password */
  changePassword = async (req: Request, res: Response): Promise<void> => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        res.status(400).json({
          success: false,
          message: 'Current and new password are required',
          errors: { validation: 'Missing required fields' },
        });
        return;
      }

      const settings = await this.systemSettingService.getCached();
      if (newPassword.length < settings.password_min_length) {
        res.status(400).json({
          success: false,
          message: `Password must be at least ${settings.password_min_length} characters`,
          errors: { password: 'Password too short' },
        });
        return;
      }

      const result = await this.authService.changePassword(
        req.user!.id,
        currentPassword,
        newPassword,
      );
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

  /** GET /api/auth/sessions — the caller's login history (device, IP, times). */
  sessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessions = await this.authService.getLoginHistory(req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Login history retrieved',
        data: { sessions },
      });
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/auth/sessions/revoke-others — sign out every other device. */
  revokeOtherSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      const result = await this.authService.revokeOtherSessions(req.user!.id, token);
      res.status(200).json({
        success: true,
        message:
          result.revoked > 0
            ? `Signed out ${result.revoked} other session${result.revoked === 1 ? '' : 's'}`
            : 'No other active sessions',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/auth/me — return the authenticated user's profile. */
  me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.userRepository.findById(req.user!.id);
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found',
          errors: {},
        });
        return;
      }

      const { password: _password, ...userWithoutPassword } = user;
      res.status(200).json({
        success: true,
        message: 'User profile retrieved successfully',
        data: { user: userWithoutPassword },
      });
    } catch (error) {
      next(error);
    }
  };
}
