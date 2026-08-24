/**
 * SearchController — MVC controller layer.
 *
 * Handles HTTP requests for message and user search and delegates business
 * logic to SearchService.
 */
import type { NextFunction, Request, Response } from 'express';
import type { SearchService } from '../services/Search.service';

export class SearchController {
  constructor(private searchService: SearchService) {}

  /** GET /api/search/messages */
  searchMessages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { q, conversation_id, page = 1, limit = 20 } = req.query;

      if (!q) {
        res.status(400).json({
          success: false,
          message: 'Search query is required',
          errors: { q: 'Search query (q) is required' },
        });
        return;
      }

      const results = await this.searchService.searchMessages(req.user!.id, String(q), {
        conversation_id: conversation_id ? String(conversation_id) : undefined,
        page: parseInt(String(page)),
        limit: parseInt(String(limit)),
      });

      res.status(200).json({
        success: true,
        message: 'Messages search completed',
        data: {
          results,
          pagination: { page: parseInt(String(page)), limit: parseInt(String(limit)), total: results.length },
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/search/users */
  searchUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

      const results = await this.searchService.searchUsers(req.user!.companyId, String(q), parseInt(String(limit)));
      res.status(200).json({
        success: true,
        message: 'Users search completed',
        data: {
          results,
        },
      });
    } catch (error) {
      next(error);
    }
  };
}
