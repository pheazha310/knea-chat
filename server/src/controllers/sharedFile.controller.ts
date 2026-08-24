/**
 * SharedFileController — MVC controller layer for shared files.
 *
 * Handles HTTP requests for shared files (upload, list, download, versioning,
 * permissions, search) and delegates business logic to SharedFileService.
 */
import type { NextFunction, Request, Response } from 'express';
import type { SharedFileService } from '../services/SharedFile.service';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const UPLOAD_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  process.env.UPLOAD_DIR || 'uploads',
);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_FILE_TYPES = (
  process.env.ALLOWED_FILE_TYPES ||
  'jpg,jpeg,png,gif,webp,pdf,doc,docx,xls,xlsx,txt,csv,zip,mp3,m4a,wav,ogg,oga,opus,webm,aac,mp4,mov,avi,webm,svg'
).split(',').map((t) => t.trim().toLowerCase());

const ALLOWED_MIME_PREFIXES = ['image/', 'audio/', 'video/', 'application/pdf', 'text/plain', 'text/csv'];
const ALLOWED_MIME_EXACT = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'image/svg+xml',
]);

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '104857600', 10);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .slice(0, 60);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}-${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (!ALLOWED_FILE_TYPES.includes(ext)) {
      return cb(new Error(`File type ".${ext}" is not allowed`));
    }

    const mime = (file.mimetype || '').toLowerCase();
    const mimeOk = ALLOWED_MIME_EXACT.has(mime) || ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));
    if (!mimeOk) {
      return cb(new Error(`File content type "${file.mimetype}" is not allowed`));
    }
    cb(null, true);
  },
});

export class SharedFileController {
  constructor(private sharedFileService: SharedFileService) {}

  /** POST /api/shared-files/upload */
  uploadFile = async (req: Request, res: Response): Promise<void> => {
    upload.single('file')(req, res, async (err: unknown) => {
      if (err) {
        const e = err as { code?: string; message?: string };
        const message =
          e.code === 'LIMIT_FILE_SIZE'
            ? `File exceeds the ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB limit`
            : e.message || 'Upload failed';
        res.status(400).json({ success: false, message, errors: { file: message } });
        return;
      }

      try {
        const company_id = req.body.company_id ? Number(req.body.company_id) : req.user!.companyId;
        const description = req.body.description || null;
        const is_public = req.body.is_public === 'true';

        if (!req.file) {
          res.status(400).json({
            success: false,
            message: 'No file was uploaded',
            errors: { file: 'A file field is required' },
          });
          return;
        }

        const file = await this.sharedFileService.createSharedFile({
          company_id,
          uploaded_by: req.user!.id,
          file_name: req.file.originalname,
          file_url: `/uploads/${req.file.filename}`,
          file_type: req.file.mimetype,
          file_size: req.file.size,
          description,
          is_public,
        });

        res.status(201).json({
          success: true,
          message: 'File uploaded successfully',
          data: { file },
        });
      } catch (error) {
        console.error('[uploadSharedFile] Service error:', (error as Error).message);
        if (req.file) {
          fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
        }
        res.status(400).json({
          success: false,
          message: (error as Error).message,
          errors: {},
        });
      }
    });
  };

  /** GET /api/shared-files */
  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = req.user!.companyId;
      const { search, fileType, isPublic, page = 1, limit = 20 } = req.query;

      const result = await this.sharedFileService.listSharedFiles({
        companyId,
        userId: req.user!.id,
        search: search as string | undefined,
        fileType: fileType as string | undefined,
        isPublic: isPublic !== undefined ? isPublic === 'true' : undefined,
        page: Number(page),
        limit: Number(limit),
      });

      res.status(200).json({
        success: true,
        message: 'Shared files retrieved successfully',
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/shared-files/:id */
  getById = async (req: Request, res: Response): Promise<void> => {
    try {
      const file = await this.sharedFileService.getSharedFile(Number(req.params.id), req.user!.id);
      res.status(200).json({
        success: true,
        message: 'File retrieved successfully',
        data: { file },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** PATCH /api/shared-files/:id */
  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const { file_name, description, is_public } = req.body;
      const file = await this.sharedFileService.updateSharedFile(Number(req.params.id), {
        file_name,
        description,
        is_public,
      }, req.user!.id);
      res.status(200).json({
        success: true,
        message: 'File updated successfully',
        data: { file },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/shared-files/:id */
  remove = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.sharedFileService.deleteSharedFile(Number(req.params.id), req.user!.id);
      res.status(200).json({
        success: true,
        message: 'File deleted successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** POST /api/shared-files/:id/versions */
  uploadVersion = async (req: Request, res: Response): Promise<void> => {
    upload.single('file')(req, res, async (err: unknown) => {
      if (err) {
        const e = err as { code?: string; message?: string };
        const message =
          e.code === 'LIMIT_FILE_SIZE'
            ? `File exceeds the ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB limit`
            : e.message || 'Upload failed';
        res.status(400).json({ success: false, message, errors: { file: message } });
        return;
      }

      try {
        const change_description = req.body.change_description || null;

        if (!req.file) {
          res.status(400).json({
            success: false,
            message: 'No file was uploaded',
            errors: { file: 'A file field is required' },
          });
          return;
        }

        const version = await this.sharedFileService.uploadNewVersion({
          file_id: Number(req.params.id),
          uploaded_by: req.user!.id,
          file_name: req.file.originalname,
          file_url: `/uploads/${req.file.filename}`,
          file_type: req.file.mimetype,
          file_size: req.file.size,
          change_description,
        });

        res.status(201).json({
          success: true,
          message: 'New version uploaded successfully',
          data: { version },
        });
      } catch (error) {
        console.error('[uploadVersion] Service error:', (error as Error).message);
        if (req.file) {
          fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
        }
        res.status(400).json({
          success: false,
          message: (error as Error).message,
          errors: {},
        });
      }
    });
  };

  /** GET /api/shared-files/:id/versions */
  getVersions = async (req: Request, res: Response): Promise<void> => {
    try {
      const versions = await this.sharedFileService.getFileVersions(Number(req.params.id), req.user!.id);
      res.status(200).json({
        success: true,
        message: 'File versions retrieved successfully',
        data: { versions },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/shared-files/:id/permissions */
  getPermissions = async (req: Request, res: Response): Promise<void> => {
    try {
      const permissions = await this.sharedFileService.getFilePermissions(Number(req.params.id), req.user!.id);
      res.status(200).json({
        success: true,
        message: 'File permissions retrieved successfully',
        data: { permissions },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** POST /api/shared-files/:id/permissions */
  grantPermission = async (req: Request, res: Response): Promise<void> => {
    try {
      const { user_id, permission } = req.body;
      const perm = await this.sharedFileService.grantPermission({
        file_id: Number(req.params.id),
        user_id: Number(user_id),
        permission,
        granted_by: req.user!.id,
      });
      res.status(201).json({
        success: true,
        message: 'Permission granted successfully',
        data: { permission: perm },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/shared-files/:id/permissions/:userId */
  revokePermission = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.sharedFileService.revokePermission(
        Number(req.params.id),
        Number(req.params.userId),
        req.user!.id,
      );
      res.status(200).json({
        success: true,
        message: 'Permission revoked successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/shared-files/search */
  search = async (req: Request, res: Response): Promise<void> => {
    try {
      const { q, fileType, page = 1, limit = 20 } = req.query;
      const files = await this.sharedFileService.searchFiles(req.user!.companyId, q as string, {
        fileType: fileType as string | undefined,
        page: Number(page),
        limit: Number(limit),
      });
      res.status(200).json({
        success: true,
        message: 'Files search completed',
        data: { files, total: files.length },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/shared-files/:id/download */
  download = async (req: Request, res: Response): Promise<void> => {
    try {
      const { file } = await this.sharedFileService.downloadFile(Number(req.params.id), req.user!.id);
      const filePath = path.join(UPLOAD_DIR, path.basename(file.file_url));
      res.download(filePath, file.file_name);
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };
}
