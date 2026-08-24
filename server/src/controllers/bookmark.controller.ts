/**
 * BookmarkController — MVC controller layer for message bookmarks.
 */
import type { NextFunction, Request, Response } from 'express';
import type { BookmarkService } from '../services/Bookmark.service';
import { sendToUser } from '../websocket/connection.registry';

export class BookmarkController {
  constructor(private bookmarkService: BookmarkService) {}

  /** POST /api/messages/:id/bookmarks */
  add = async (req: Request, res: Response): Promise<void> => {
    try {
      const messageId = Number(req.params.id);
      const bookmark = await this.bookmarkService.bookmark(messageId, req.user!.id);

      sendToUser(req.user!.id, JSON.stringify({
        type: 'bookmark_added',
        data: { messageId, bookmark },
        timestamp: new Date().toISOString(),
      }));

      res.status(201).json({
        success: true,
        message: 'Message bookmarked successfully',
        data: { bookmark },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };

  /** DELETE /api/messages/:id/bookmarks */
  remove = async (req: Request, res: Response): Promise<void> => {
    try {
      const messageId = Number(req.params.id);
      const result = await this.bookmarkService.unbookmark(messageId, req.user!.id);

      sendToUser(req.user!.id, JSON.stringify({
        type: 'bookmark_removed',
        data: { messageId },
        timestamp: new Date().toISOString(),
      }));

      res.status(200).json({
        success: true,
        message: 'Bookmark removed successfully',
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

  /** GET /api/bookmarks */
  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const bookmarks = await this.bookmarkService.getUserBookmarks(
        req.user!.id,
        Number(page),
        Number(limit),
      );

      res.status(200).json({
        success: true,
        message: 'Bookmarks retrieved successfully',
        data: {
          bookmarks,
          pagination: {
            page: parseInt(String(page)),
            limit: parseInt(String(limit)),
            total: bookmarks.length,
          },
        },
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
