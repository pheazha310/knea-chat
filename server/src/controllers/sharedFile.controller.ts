/**
 * SharedFileController — MVC controller layer for shared files.
 *
 * Handles HTTP requests for shared files (upload, list, download, versioning,
 * permissions, search) and delegates business logic to SharedFileService.
 */
import type { NextFunction, Request, Response } from 'express';
import type { SharedFileService } from '../services/SharedFile.service';
import type { BroadcastToConversation } from '../websocket/broadcast.utils';
import { serializeMessage } from '../websocket/message.utils';
import { sendToUser } from '../websocket/connection.registry';
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
  constructor(
    private sharedFileService: SharedFileService,
    private broadcastToConversation: BroadcastToConversation,
  ) {}

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
        // Non-null when the upload targets a team's file area.
        const rawTeamId = req.body.team_id ? Number(req.body.team_id) : 0;
        const team_id = Number.isFinite(rawTeamId) && rawTeamId > 0 ? rawTeamId : null;

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
          team_id,
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

  /** GET /api/shared-files/team/:teamId — team file area (member/manager only) */
  listTeamFiles = async (req: Request, res: Response): Promise<void> => {
    try {
      const teamId = Number(req.params.teamId);
      if (!Number.isFinite(teamId) || teamId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid team id', errors: {} });
        return;
      }
      const { search, fileType, page = 1, limit = 20 } = req.query;
      const result = await this.sharedFileService.listTeamFiles(teamId, req.user!.id, {
        search: search as string | undefined,
        fileType: fileType as string | undefined,
        page: Number(page),
        limit: Number(limit),
      });
      res.status(200).json({
        success: true,
        message: 'Team files retrieved successfully',
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

  /** GET /api/shared-files/:id/shares */
  listShares = async (req: Request, res: Response): Promise<void> => {
    try {
      const shares = await this.sharedFileService.getFileShares(Number(req.params.id), req.user!.id);
      res.status(200).json({
        success: true,
        message: 'File shares retrieved successfully',
        data: { shares },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** POST /api/shared-files/:id/shares */
  shareFile = async (req: Request, res: Response): Promise<void> => {
    try {
      const target_type = String(req.body.target_type || '');
      const target_id = Number(req.body.target_id);
      if (!Number.isFinite(target_id) || target_id <= 0) {
        res.status(400).json({ success: false, message: 'Invalid target_id', errors: { target_id: 'A positive target id is required' } });
        return;
      }
      const share = await this.sharedFileService.shareFile(
        Number(req.params.id),
        req.user!.id,
        target_type,
        target_id,
      );
      res.status(201).json({
        success: true,
        message: 'File shared successfully',
        data: { share },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/shared-files/:id/shares/:shareId */
  unshareFile = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.sharedFileService.unshareFile(Number(req.params.shareId), req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Share removed successfully',
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

  /**
   * POST /api/shared-files/:id/embed — share the file into a conversation as
   * a chat message. Body: `{ conversation_id }`.
   */
  embed = async (req: Request, res: Response): Promise<void> => {
    try {
      const conversation_id = Number(req.body.conversation_id);
      if (!Number.isFinite(conversation_id) || conversation_id <= 0) {
        res.status(400).json({
          success: false,
          message: 'Invalid conversation_id',
          errors: { conversation_id: 'A positive conversation id is required' },
        });
        return;
      }

      const result = await this.sharedFileService.embedInConversation(
        Number(req.params.id),
        req.user!.id,
        conversation_id,
      );

      // Live-sync the file message to every connected member except the
      // sender, exactly like a chat upload (same `receive_message` event).
      const serialized = serializeMessage(result.message);
      void this.broadcastToConversation(
        conversation_id,
        { type: 'receive_message', message: serialized },
        { excludeUserId: req.user!.id },
      );

      // Keep recipient bells/unread badges in sync (new_message path).
      const { notifiedUserIds = [] } = result.message;
      const senderName =
        [result.message.first_name, result.message.last_name].filter(Boolean).join(' ').trim() ||
        'Someone';
      const snippet =
        result.file.file_name.length > 120
          ? `${result.file.file_name.slice(0, 120)}…`
          : result.file.file_name;
      for (const userId of notifiedUserIds) {
        if (Number(userId) === Number(req.user!.id)) continue;
        sendToUser(Number(userId), JSON.stringify({
          type: 'notification',
          data: {
            type: 'new_message',
            title: senderName,
            message: snippet,
            conversationId: conversation_id,
            messageId: result.message.id,
          },
        }));
      }

      res.status(201).json({
        success: true,
        message: 'File shared into the conversation',
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
