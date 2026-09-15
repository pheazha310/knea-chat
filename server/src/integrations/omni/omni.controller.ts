/**
 * OmniController — HTTP handlers shared by every channel adapter.
 *
 *   GET    /api/omni/health/:channel        — public health probe
 *   GET    /api/omni/capabilities           — public per-channel capabilities
 *   POST   /api/omni/conversations/:id/assign   — claim (any inbox member)
 *   DELETE /api/omni/conversations/:id/assign   — unassign
 *   PATCH  /api/omni/conversations/:id/status   — open/close
 *   POST   /api/omni/conversations/:id/messages — agent reply (any channel)
 *   POST   /api/omni/conversations/:id/media    — agent file/voice reply
 *
 * Channel webhooks are NOT routed here generically: each channel owns its
 * provider-specific webhook endpoint + secret check (e.g. Telegram's
 * `/api/telegram/webhook` validates `X-Telegram-Bot-Api-Secret-Token`), so a
 * future channel cannot be reached through a generic unauthenticated route.
 */
import type { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import type { OmniChannelService } from '../../services/OmniChannel.service';
import { resolveUploadDir, isAllowedUpload, MAX_FILE_SIZE } from '../../utils/uploads';

// ---------------------------------------------------------------------------
// Outbound media upload configuration — the SAME file policy as the internal
// chat upload (shared helper in utils/uploads), relayed to channel adapters.
// ---------------------------------------------------------------------------
const UPLOAD_DIR = resolveUploadDir();
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
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
  fileFilter: (_req, file, cb) => {
    if (!isAllowedUpload(file)) {
      return cb(new Error(`File content type "${file.mimetype}" is not allowed`));
    }
    cb(null, true);
  },
});

export class OmniController {
  constructor(private omniService: OmniChannelService) {}

  /** GET /api/omni/health/:channel — public. */
  health = async (req: Request, res: Response): Promise<void> => {
    const channel = String(req.params.channel || '').toLowerCase();
    try {
      const health = await this.omniService.getHealth(channel);
      res.status(200).json({
        success: health.connected,
        channel,
        connected: health.connected,
        ...(health.info ? { info: health.info } : {}),
      });
    } catch (error) {
      res.status(200).json({
        success: false,
        channel,
        connected: false,
        message: (error as Error).message,
      });
    }
  };

  /**
   * GET /api/omni/capabilities — per-channel feature map (public, read-only,
   * no secrets): which channels can relay outbound media. The composer uses
   * this to show/hide its attach + voice entry points per conversation.
   */
  capabilities = async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json({ success: true, data: { channels: this.omniService.getCapabilities() } });
  };

  /** POST /api/omni/conversations/:id/assign — claim (defaults to self). */
  assignConversation = async (req: Request, res: Response): Promise<void> => {
    try {
      const conversationId = Number(req.params.id);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid conversation id', errors: {} });
        return;
      }
      const agentId = req.body?.agentId ? Number(req.body.agentId) : req.user!.id;
      const result = await this.omniService.assignAgent(conversationId, req.user!.id, agentId);
      res.status(200).json({ success: true, message: 'Conversation assigned', data: result });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 400).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };

  /** DELETE /api/omni/conversations/:id/assign — unassign. */
  unassignConversation = async (req: Request, res: Response): Promise<void> => {
    try {
      const conversationId = Number(req.params.id);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid conversation id', errors: {} });
        return;
      }
      const result = await this.omniService.assignAgent(conversationId, req.user!.id, null);
      res.status(200).json({ success: true, message: 'Conversation unassigned', data: result });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 400).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };

  /**
   * POST /api/omni/conversations/:id/messages — agent reply to any channel.
   * The provider chat id is resolved server-side from the stored contact.
   */
  sendMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      const conversationId = Number(req.params.id);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid conversation id', errors: {} });
        return;
      }
      const text = String(req.body?.text || '');
      if (!text.trim()) {
        res.status(400).json({ success: false, message: 'text is required', errors: {} });
        return;
      }
      const replyToMessageId = req.body?.replyToMessageId
        ? Number(req.body.replyToMessageId)
        : null;
      const message = await this.omniService.sendAgentReply(
        conversationId,
        req.user!.id,
        text,
        replyToMessageId,
      );
      res.status(201).json({ success: true, data: { message } });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 400).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };

  /**
   * POST /api/omni/conversations/:id/media — agent file / voice reply.
   * Multipart form: `file` (+ optional `caption`, `replyToMessageId`). The
   * channel delivery happens first; persistence mirrors the text reply path.
   */
  sendMedia = async (req: Request, res: Response): Promise<void> => {
    const cleanup = () => {
      if (req.file) fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
    };
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

      const conversationId = Number(req.params.id);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        cleanup();
        res.status(400).json({ success: false, message: 'Invalid conversation id', errors: {} });
        return;
      }
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No file was uploaded', errors: { file: 'A file field is required' } });
        return;
      }

      const kind: 'image' | 'voice' | 'file' =
        String(req.body?.kind || '').toLowerCase() === 'voice' ||
        (req.file.mimetype || '').startsWith('audio/')
          ? 'voice'
          : (req.file.mimetype || '').startsWith('image/')
            ? 'image'
            : 'file';

      try {
        const buffer = fs.readFileSync(path.join(UPLOAD_DIR, req.file.filename));
        const message = await this.omniService.sendAgentMediaReply(
          conversationId,
          req.user!.id,
          {
            kind,
            buffer,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype || null,
            caption: String(req.body?.caption || ''),
          },
          req.body?.replyToMessageId ? Number(req.body.replyToMessageId) : null,
        );
        res.status(201).json({ success: true, data: { message } });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        res.status(statusCode || 400).json({ success: false, message: (error as Error).message, errors: {} });
      } finally {
        // The service keeps its own copy under /uploads; the temp file goes.
        cleanup();
      }
    });
  };

  /** PATCH /api/omni/conversations/:id/status — open / close. */
  setStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const conversationId = Number(req.params.id);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid conversation id', errors: {} });
        return;
      }
      const status = String(req.body?.status || '');
      if (status !== 'open' && status !== 'closed') {
        res.status(400).json({ success: false, message: 'status must be "open" or "closed"', errors: {} });
        return;
      }
      const result = await this.omniService.setConversationStatus(conversationId, req.user!.id, status);
      res.status(200).json({ success: true, message: `Conversation ${status}`, data: result });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      res.status(statusCode || 400).json({ success: false, message: (error as Error).message, errors: {} });
    }
  };
}