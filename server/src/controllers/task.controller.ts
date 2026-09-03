/**
 * TaskController — MVC controller layer for tasks (assign, team scope,
 * deadline, status, comments, attachments).
 */
import type { Request, Response } from 'express';
import type { TaskService } from '../services/Task.service';
import type { TaskPriority, TaskStatus } from '../types';
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

const toNullablePositiveInt = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Parse team_id filter: undefined = all, 0 = personal, positive = a team. */
const parseTeamIdFilter = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export class TaskController {
  constructor(private taskService: TaskService) {}

  /**
   * GET /api/tasks?status=&search=&priority=&assignee_id=&team_id=&page=&limit=
   * `team_id=0` returns personal tasks (no team); a positive value filters a
   * team. Managers see the whole company; employees only tasks they can view.
   */
  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const { status, search, priority, page = 1, limit = 50 } = req.query;
      const teamId = parseTeamIdFilter(req.query.team_id);
      const assigneeId = req.query.assignee_id !== undefined
        ? toNullablePositiveInt(req.query.assignee_id)
        : undefined;
      const result = await this.taskService.listTasks(
        req.user!.id,
        req.user!.role,
        req.user!.companyId,
        {
          assigneeId: assigneeId ?? undefined,
          teamId,
          status: status as string | undefined,
          priority: priority as string | undefined,
          search: search as string | undefined,
          page: Number(page),
          limit: Number(limit),
        },
      );
      res.status(200).json({
        success: true,
        message: 'Tasks retrieved successfully',
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

  /** POST /api/tasks — body: { title, description?, team_id?, assignee_id?, due_date?, priority? } */
  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, description, priority } = req.body;
      const assignee_id = toNullablePositiveInt(req.body.assignee_id);
      const team_id = toNullablePositiveInt(req.body.team_id);
      const task = await this.taskService.createTask({
        company_id: req.user!.companyId,
        created_by: req.user!.id,
        role: req.user!.role,
        title,
        description: description ?? null,
        team_id,
        assignee_id,
        due_date: req.body.due_date || null,
        priority: priority as TaskPriority | undefined,
      });
      res.status(201).json({
        success: true,
        message: 'Task created successfully',
        data: { task },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** PATCH /api/tasks/:id */
  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const payload: Record<string, unknown> = {};
      if (req.body.title !== undefined) payload.title = req.body.title;
      if (req.body.description !== undefined) payload.description = req.body.description;
      if (req.body.team_id !== undefined) payload.team_id = toNullablePositiveInt(req.body.team_id);
      if (req.body.assignee_id !== undefined) payload.assignee_id = toNullablePositiveInt(req.body.assignee_id);
      if (req.body.due_date !== undefined) payload.due_date = req.body.due_date || null;
      if (req.body.priority !== undefined) payload.priority = req.body.priority as TaskPriority;
      if (req.body.status !== undefined) payload.status = req.body.status as TaskStatus;

      const task = await this.taskService.updateTask(
        Number(req.params.id),
        req.user!.id,
        req.user!.role,
        payload,
      );
      res.status(200).json({
        success: true,
        message: 'Task updated successfully',
        data: { task },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/tasks/:id */
  remove = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.taskService.deleteTask(
        Number(req.params.id),
        req.user!.id,
        req.user!.role,
      );
      res.status(200).json({ success: true, ...result });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  // -------------------------------------------------------------------------
  // Comments
  // -------------------------------------------------------------------------

  /** GET /api/tasks/:id/comments */
  listComments = async (req: Request, res: Response): Promise<void> => {
    try {
      const comments = await this.taskService.listComments(
        Number(req.params.id),
        req.user!.id,
      );
      res.status(200).json({
        success: true,
        message: 'Comments retrieved successfully',
        data: { comments },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** POST /api/tasks/:id/comments — body: { content } */
  addComment = async (req: Request, res: Response): Promise<void> => {
    try {
      const comment = await this.taskService.addComment(
        Number(req.params.id),
        req.user!.id,
        String(req.body.content || ''),
      );
      res.status(201).json({
        success: true,
        message: 'Comment added successfully',
        data: { comment },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/tasks/:id/comments/:commentId */
  removeComment = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.taskService.deleteComment(
        Number(req.params.commentId),
        req.user!.id,
        req.user!.role,
      );
      res.status(200).json({
        success: true,
        message: 'Comment deleted successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  // -------------------------------------------------------------------------
  // Attachments
  // -------------------------------------------------------------------------

  /** GET /api/tasks/:id/attachments */
  listAttachments = async (req: Request, res: Response): Promise<void> => {
    try {
      const attachments = await this.taskService.listAttachments(
        Number(req.params.id),
        req.user!.id,
      );
      res.status(200).json({
        success: true,
        message: 'Attachments retrieved successfully',
        data: { attachments },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** POST /api/tasks/:id/attachments — multipart `file` field. */
  uploadAttachment = async (req: Request, res: Response): Promise<void> => {
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
        if (!req.file) {
          res.status(400).json({
            success: false,
            message: 'No file was uploaded',
            errors: { file: 'A file field is required' },
          });
          return;
        }
        const attachment = await this.taskService.addAttachment(
          Number(req.params.id),
          req.user!.id,
          {
            file_name: req.file.originalname,
            file_url: `/uploads/${req.file.filename}`,
            file_type: req.file.mimetype,
            file_size: req.file.size,
          },
        );
        res.status(201).json({
          success: true,
          message: 'Attachment uploaded successfully',
          data: { attachment },
        });
      } catch (error) {
        console.error('[uploadTaskAttachment] Service error:', (error as Error).message);
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

  /** DELETE /api/tasks/:id/attachments/:attachmentId */
  removeAttachment = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.taskService.deleteAttachment(
        Number(req.params.attachmentId),
        req.user!.id,
        req.user!.role,
      );
      // Remove the stored file too (best-effort; the DB row is already gone).
      if (result.file_url?.startsWith('/uploads/')) {
        fs.unlink(path.join(UPLOAD_DIR, path.basename(result.file_url)), () => {});
      }
      res.status(200).json({
        success: true,
        message: 'Attachment deleted successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };
}
