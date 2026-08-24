/**
 * UserController — MVC controller layer.
 *
 * Handles HTTP requests for user management (list, create, update, delete,
 * profile picture upload) and delegates business logic to UserService.
 */
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import type { NextFunction, Request, Response } from 'express';
import type { UserService } from '../services/User.service';
import type { UserRepository } from '../repositories/userRepository';
import { broadcastToAll } from '../websocket/broadcast.utils';
import { wssRef } from '../websocket/websocket.server';
import type { SystemSettingService } from '../services/SystemSetting.service';

// ---------------------------------------------------------------------------
// Profile picture upload (SRS FR-17 pattern — store the file, save its URL)
// ---------------------------------------------------------------------------
const AVATAR_UPLOAD_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  process.env.UPLOAD_DIR || 'uploads',
);
fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });

const ALLOWED_AVATAR_TYPES = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const MAX_AVATAR_SIZE = parseInt(process.env.MAX_AVATAR_SIZE || '5242880', 10); // 5 MB

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .slice(0, 40);
    cb(null, `avatar-${Date.now()}-${Math.round(Math.random() * 1e6)}-${base}${ext}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: MAX_AVATAR_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (!ALLOWED_AVATAR_TYPES.includes(ext)) {
      return cb(new Error('Avatar must be a JPG, PNG, GIF, or WebP image'));
    }
    if (!(file.mimetype || '').toLowerCase().startsWith('image/')) {
      return cb(new Error('Avatar must be an image file'));
    }
    cb(null, true);
  },
});

export class UserController {
  constructor(
    private userService: UserService,
    private userRepository: UserRepository,
    private systemSettingService: SystemSettingService,
  ) {}

  /** GET /api/users */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page = 1, limit = 20, search = '', role = '', department_id = '' } = req.query;

      const result = await this.userService.getUsers({
        companyId: req.user!.companyId,
        page: Number(page),
        limit: Number(limit),
        search: String(search),
        role: String(role),
        department_id: String(department_id),
      });

      res.status(200).json({
        success: true,
        message: 'Users retrieved successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/users/:id */
  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = Number(req.params.id);
      const user = await this.userService.getUser(userId);

      const { password: _password, ...userWithoutPassword } = user;
      res.status(200).json({
        success: true,
        message: 'User retrieved successfully',
        data: { user: userWithoutPassword },
      });
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/users */
  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const { first_name, last_name, email, password, role, job_title, department_id } = req.body;

      if (!first_name || !last_name || !email || !password) {
        res.status(400).json({
          success: false,
          message: 'Missing required fields',
          errors: { validation: 'Required fields: first_name, last_name, email, password' },
        });
        return;
      }

      // Platform limit on users per organization (0 = unlimited).
      const settings = await this.systemSettingService.getCached();
      if (settings.max_users_per_org > 0) {
        const userCount = await this.userRepository.countByCompany(req.user!.companyId);
        if (userCount >= settings.max_users_per_org) {
          res.status(403).json({
            success: false,
            message: `This workspace has reached its limit of ${settings.max_users_per_org} users.`,
            errors: { validation: 'Workspace user limit reached' },
          });
          return;
        }
      }

      const user = await this.userService.createUser({
        company_id: req.user!.companyId,
        first_name,
        last_name,
        email,
        password,
        role,
        job_title,
        department_id,
      }, req.user || null);

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: { user },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** PATCH /api/users/:id */
  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = Number(req.params.id);
      const { first_name, last_name, job_title, profile_picture, status, department_id, role, is_active } = req.body;

      const user = await this.userService.updateUser(
        userId,
        {
          first_name,
          last_name,
          job_title,
          profile_picture,
          status,
          department_id,
          role,
          is_active,
        },
        req.user!.id,
        req.user!.role,
        req.user!.companyId,
      );

      const { password: _password, ...userWithoutPassword } = user;
      res.status(200).json({
        success: true,
        message: 'User updated successfully',
        data: { user: userWithoutPassword },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /**
   * POST /api/users/:id/avatar
   * Multipart form: `avatar` file. Stores the file under /uploads and saves its
   * URL in `profile_picture` — the column is VARCHAR(500), so a base64 data URL
   * (which can be megabytes) must never be sent through PATCH /users/:id.
   */
  uploadAvatar = async (req: Request, res: Response): Promise<void> => {
    avatarUpload.single('avatar')(req, res, async (err: unknown) => {
      if (err) {
        const e = err as { code?: string; message?: string };
        const message =
          e.code === 'LIMIT_FILE_SIZE'
            ? `Avatar image must be under ${Math.round(MAX_AVATAR_SIZE / 1024 / 1024)} MB`
            : e.message || 'Upload failed';
        res.status(400).json({ success: false, message, errors: { avatar: message } });
        return;
      }

      try {
        const userId = Number(req.params.id);

        if (!req.file) {
          res.status(400).json({
            success: false,
            message: 'No avatar image was uploaded',
            errors: { avatar: 'An image file is required' },
          });
          return;
        }

        const fileUrl = `/uploads/${req.file.filename}`;

        // Capture the current avatar so we can delete the old file after the
        // update succeeds (updateUser returns the post-update row).
        const current = await this.userService.getUser(userId);
        const oldAvatar = current.profile_picture;

        // updateUser enforces self-or-admin authorization and throws on failure.
        const user = await this.userService.updateUser(
          userId,
          { profile_picture: fileUrl },
          req.user!.id,
          req.user!.role,
          req.user!.companyId,
        );

        // Clean up the previous avatar file so uploads don't accumulate.
        if (oldAvatar && oldAvatar.startsWith('/uploads/')) {
          fs.unlink(path.join(AVATAR_UPLOAD_DIR, path.basename(oldAvatar)), () => {});
        }

        // Push the new photo to every connected client so avatars update live.
        if (wssRef.current) {
          broadcastToAll(
            {
              type: 'user_profile_updated',
              data: { userId: Number(userId), profilePicture: fileUrl },
            },
            wssRef.current,
          );
        }

        const { password: _password, ...userWithoutPassword } = user;
        res.status(200).json({
          success: true,
          message: 'Profile picture updated successfully',
          data: { user: userWithoutPassword },
        });
      } catch (error) {
        // Clean up the file if the profile could not be updated.
        if (req.file) {
          fs.unlink(path.join(AVATAR_UPLOAD_DIR, req.file.filename), () => {});
        }
        res.status(400).json({
          success: false,
          message: (error as Error).message,
          errors: {},
        });
      }
    });
  };

  /** DELETE /api/users/:id */
  remove = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = Number(req.params.id);
      const result = await this.userService.deleteUser(userId, req.user || null);
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

  /** GET /api/users/search */
  search = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { q, limit = 20 } = req.query;

      if (!q) {
        res.status(400).json({
          success: false,
          message: 'Search query is required',
          errors: { q: 'Search query (q) is required' },
        });
        return;
      }

      const users = await this.userService.searchUsers(req.user!.companyId, String(q), parseInt(String(limit)));
      res.status(200).json({
        success: true,
        message: 'Users search completed',
        data: { results: users },
      });
    } catch (error) {
      next(error);
    }
  };
}
