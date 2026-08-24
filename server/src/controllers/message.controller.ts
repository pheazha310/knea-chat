/**
 * MessageController — MVC controller layer.
 *
 * Handles HTTP requests for messages (send, update, delete, pin, reactions,
 * file upload) and delegates business logic to MessageService.
 */
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import type { NextFunction, Request, Response } from 'express';
import type { MessageService } from '../services/Message.service';
import type { SystemSettingService } from '../services/SystemSetting.service';
import type { BroadcastToConversation } from '../websocket/broadcast.utils';
import { serializeMessage } from '../websocket/message.utils';
import { sendToUser } from '../websocket/connection.registry';

// ---------------------------------------------------------------------------
// File upload configuration (SRS §19: validate file type and size)
// ---------------------------------------------------------------------------
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
  'jpg,jpeg,png,gif,webp,pdf,doc,docx,xls,xlsx,txt,csv,zip,mp3,m4a,wav,ogg,oga,opus,webm,aac'
).split(',').map((t) => t.trim().toLowerCase());

// MIME-type allowlist (SRS §19: validate file type — extension AND content type).
const ALLOWED_MIME_PREFIXES = ['image/', 'audio/', 'application/pdf', 'text/plain', 'text/csv'];
const ALLOWED_MIME_EXACT = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '10485760', 10);

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

export class MessageController {
  constructor(
    private messageService: MessageService,
    private systemSettingService: SystemSettingService,
    private broadcastToConversation: BroadcastToConversation,
  ) {}

  /** POST /api/messages */
  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversation_id, content, type = 'text', reply_to } = req.body;

      if (!conversation_id || !content) {
        res.status(400).json({
          success: false,
          message: 'Conversation ID and content are required',
          errors: { validation: 'Missing required fields' },
        });
        return;
      }

      const message = await this.messageService.createMessage({
        conversation_id,
        sender_id: req.user!.id,
        content,
        type,
        reply_to,
      });

      res.status(201).json({
        success: true,
        message: 'Message sent successfully',
        data: { message },
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
   * POST /api/messages/upload
   * Multipart form: `conversation_id` + `file`.
   * Creates a `file` type message with an attachments row (SRS FR-17).
   */
  uploadFile = async (req: Request, res: Response): Promise<void> => {
    let settings;
    try {
      settings = await this.systemSettingService.getCached();
      if (!settings.allow_uploads) {
        res.status(403).json({
          success: false,
          message: 'File uploads are currently disabled by your platform administrator.',
          errors: { file: 'Uploads disabled' },
        });
        return;
      }
    } catch (error) {
      res.status(500).json({ success: false, message: 'Upload unavailable', errors: {} });
      return;
    }

    upload.single('file')(req, res, async (err: unknown) => {
      if (err) {
        const e = err as { code?: string; message?: string };
        console.error('[uploadFile] Multer error:', e.code, e.message);
        const message =
          e.code === 'LIMIT_FILE_SIZE'
            ? `File exceeds the ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB limit`
            : e.message || 'Upload failed';
        res.status(400).json({ success: false, message, errors: { file: message } });
        return;
      }
      console.log('[uploadFile] Multer OK — body:', JSON.stringify(req.body), 'file:', req.file?.originalname, req.file?.mimetype, req.file?.size);

      try {
        const conversation_id = req.body.conversation_id;
        if (!conversation_id) {
          res.status(400).json({
            success: false,
            message: 'conversation_id is required',
            errors: { conversation_id: 'Missing conversation_id' },
          });
          return;
        }

        if (!req.file) {
          res.status(400).json({
            success: false,
            message: 'No file was uploaded',
            errors: { file: 'A file field is required' },
          });
          return;
        }

        // Platform file-size limit (defaults to the env hard cap).
        const maxBytes = settings.max_upload_size_mb * 1024 * 1024;
        if (req.file.size > maxBytes) {
          fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
          res.status(400).json({
            success: false,
            message: `File exceeds the ${settings.max_upload_size_mb} MB platform limit`,
            errors: { file: 'File too large' },
          });
          return;
        }

        const isAudio = (req.file.mimetype || '').startsWith('audio/');
        const message = await this.messageService.createFileMessage({
          conversation_id,
          sender_id: req.user!.id,
          file: {
            file_name: req.file.originalname,
            file_url: `/uploads/${req.file.filename}`,
            file_type: req.file.mimetype,
            file_size: req.file.size,
          },
          type: isAudio ? 'voice' : undefined,
        });

        // Live-sync the file message to every connected member except the
        // sender (same `receive_message` event text messages use), so
        // recipients see the attachment appear without a page refresh.
        const serialized = serializeMessage(message);
        void this.broadcastToConversation(
          Number(conversation_id),
          { type: 'receive_message', message: serialized },
          { excludeUserId: req.user!.id },
        );

        // Real-time notifications (SRS FR-14 / FR-15): keep recipient bells
        // and unread badges in sync, mirroring the text-message path.
        const { mentionedUserIds = [], notifiedUserIds = [] } = message;
        const snippet =
          req.file.originalname.length > 120
            ? `${req.file.originalname.slice(0, 120)}…`
            : req.file.originalname;
        const senderName =
          [message.first_name, message.last_name].filter(Boolean).join(' ').trim() ||
          'Someone';

        for (const userId of mentionedUserIds) {
          if (Number(userId) === Number(req.user!.id)) continue;
          sendToUser(userId, JSON.stringify({
            type: 'notification',
            data: {
              type: 'mention',
              title: `${senderName} mentioned you`,
              message: snippet,
              conversationId: Number(conversation_id),
              messageId: message.id,
            },
          }));
        }

        for (const userId of notifiedUserIds) {
          if (Number(userId) === Number(req.user!.id)) continue;
          sendToUser(userId, JSON.stringify({
            type: 'notification',
            data: {
              type: 'new_message',
              title: senderName,
              message: snippet,
              conversationId: Number(conversation_id),
              messageId: message.id,
            },
          }));
        }

        res.status(201).json({
          success: true,
          message: 'File sent successfully',
          data: { message },
        });
      } catch (error) {
        console.error('[uploadFile] Service error:', (error as Error).message);
        // Clean up the file if the message could not be persisted.
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

  /** PATCH /api/messages/:id */
  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const messageId = Number(req.params.id);
      const { content } = req.body;

      if (!content) {
        res.status(400).json({
          success: false,
          message: 'Content is required',
          errors: { content: 'Content is required' },
        });
        return;
      }

      const message = await this.messageService.updateMessage(messageId, content, req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Message updated successfully',
        data: { message },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/messages/:id */
  remove = async (req: Request, res: Response): Promise<void> => {
    try {
      const messageId = Number(req.params.id);
      const result = await this.messageService.deleteMessage(messageId, req.user!.id);
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

  /** POST /api/messages/:id/forward */
  forward = async (req: Request, res: Response): Promise<void> => {
    try {
      const messageId = Number(req.params.id);
      const { conversationId } = req.body;

      if (!conversationId) {
        res.status(400).json({
          success: false,
          message: 'Target conversation ID is required',
          errors: { conversationId: 'Required' },
        });
        return;
      }

      const message = await this.messageService.forwardMessage(messageId, Number(conversationId), req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Message forwarded successfully',
        data: { message },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** POST /api/messages/:id/pin */
  pin = async (req: Request, res: Response): Promise<void> => {
    try {
      const settings = await this.systemSettingService.getCached();
      if (!settings.allow_pinning) {
        res.status(403).json({
          success: false,
          message: 'Message pinning is currently disabled.',
          errors: { pin: 'Pinning disabled' },
        });
        return;
      }

      const messageId = Number(req.params.id);
      const message = await this.messageService.pinMessage(messageId, req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Message pinned successfully',
        data: { message },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/messages/:id/pin */
  unpin = async (req: Request, res: Response): Promise<void> => {
    try {
      const settings = await this.systemSettingService.getCached();
      if (!settings.allow_pinning) {
        res.status(403).json({
          success: false,
          message: 'Message pinning is currently disabled.',
          errors: { pin: 'Pinning disabled' },
        });
        return;
      }

      const messageId = Number(req.params.id);
      const message = await this.messageService.unpinMessage(messageId, req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Message unpinned successfully',
        data: { message },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** POST /api/messages/:id/reactions */
  addReaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const settings = await this.systemSettingService.getCached();
      if (!settings.allow_reactions) {
        res.status(403).json({
          success: false,
          message: 'Reactions are currently disabled.',
          errors: { reaction: 'Reactions disabled' },
        });
        return;
      }

      const messageId = Number(req.params.id);
      const { reaction } = req.body;

      if (!reaction) {
        res.status(400).json({
          success: false,
          message: 'Reaction is required',
          errors: { reaction: 'Reaction emoji/text is required' },
        });
        return;
      }

      const { conversationId, reactions } = await this.messageService.addReaction(
        messageId,
        req.user!.id,
        reaction,
      );
      res.status(201).json({
        success: true,
        message: 'Reaction added successfully',
        data: { reactions },
      });
      // Live-sync other members of the conversation (SRS §11.1 real-time).
      void this.broadcastToConversation(
        conversationId,
        {
          type: 'message_reacted',
          data: { conversationId, messageId, reactions },
          timestamp: new Date().toISOString(),
        },
        { excludeUserId: req.user!.id },
      );
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** GET /api/messages/:id/thread — returns the parent message + all replies */
  getThread = async (req: Request, res: Response): Promise<void> => {
    try {
      const messageId = Number(req.params.id);
      const { page = 1, limit = 30 } = req.query;

      const thread = await this.messageService.getThreadReplies(messageId, Number(page), Number(limit), req.user!.id);
      res.status(200).json({
        success: true,
        message: 'Thread replies retrieved successfully',
        data: thread,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/messages/:id/reactions/:reactionType */
  removeReaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const settings = await this.systemSettingService.getCached();
      if (!settings.allow_reactions) {
        res.status(403).json({
          success: false,
          message: 'Reactions are currently disabled.',
          errors: { reaction: 'Reactions disabled' },
        });
        return;
      }

      const messageId = Number(req.params.id);
      const { reactionType } = req.params;
      const { conversationId, reactions } = await this.messageService.removeReaction(
        messageId,
        req.user!.id,
        String(reactionType),
      );
      res.status(200).json({
        success: true,
        message: 'Reaction removed successfully',
        data: { reactions },
      });
      void this.broadcastToConversation(
        conversationId,
        {
          type: 'message_unreacted',
          data: { conversationId, messageId, reactions },
          timestamp: new Date().toISOString(),
        },
        { excludeUserId: req.user!.id },
      );
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };
}
