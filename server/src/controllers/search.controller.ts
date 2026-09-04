/**
 * SearchController — MVC controller layer.
 *
 * Handles HTTP requests for message/user quick search plus the global Search
 * view (overview + per-scope results) and delegates business logic to
 * SearchService.
 */
import type { NextFunction, Request, Response } from 'express';
import type { SearchService } from '../services/Search.service';
import type { GlobalSearchFilters, SearchScope } from '../types/Search';

/** Allowed scopes for the per-scope search endpoint. */
const SCOPES: SearchScope[] = [
  'messages',
  'people',
  'teams',
  'channels',
  'files',
  'meetings',
  'tasks',
];

/** Reads the shared filter bag from the query string. */
const readFilters = (req: Request): GlobalSearchFilters => {
  const { q, person_id, team_id, department_id, file_type, message_type, date_from, date_to } = req.query;
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const num = (v: unknown): number | undefined => {
    const s = str(v);
    if (s === undefined) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    q: str(q),
    person_id: num(person_id),
    team_id: num(team_id),
    department_id: num(department_id),
    file_type: str(file_type),
    message_type: str(message_type),
    date_from: str(date_from),
    date_to: str(date_to),
  };
};

/** At least one criterion must be present to avoid full-table overview scans. */
const hasCriteria = (f: GlobalSearchFilters): boolean =>
  !!(f.q || f.person_id || f.team_id || f.department_id || f.file_type || f.message_type || f.date_from || f.date_to);

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

  /**
   * GET /api/search/global — the Search view overview. Returns top hits and
   * totals for every scope, ready for a grouped overview page.
   */
  global = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filters = readFilters(req);
      if (!hasCriteria(filters)) {
        res.status(200).json({
          success: true,
          message: 'Global search requires a query or at least one filter',
          data: { groups: {} },
        });
        return;
      }

      const groups = await this.searchService.globalOverview(req.user!, filters);
      res.status(200).json({
        success: true,
        message: 'Global search completed',
        data: { groups },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/search/global/:scope — full paginated results for one scope
   * ("See all N" expansion in the Search view).
   */
  globalScope = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { scope } = req.params;
      const { page = 1, limit = 20 } = req.query;

      if (!SCOPES.includes(scope as SearchScope)) {
        res.status(400).json({
          success: false,
          message: 'Unknown search scope',
          errors: { scope: `Scope must be one of: ${SCOPES.join(', ')}` },
        });
        return;
      }

      const filters = readFilters(req);
      const result = await this.searchService.searchScope(
        req.user!,
        scope as SearchScope,
        filters,
        parseInt(String(page)),
        parseInt(String(limit)),
      );

      res.status(200).json({
        success: true,
        message: `Search results for ${scope}`,
        data: { result },
      });
    } catch (error) {
      next(error);
    }
  };
}
