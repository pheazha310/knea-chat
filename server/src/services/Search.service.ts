/**
 * SearchService — business logic for workspace search.
 *
 * Message/user search (the ⌘K quick search) plus the global Search view:
 * one overview query across the seven scopes, and per-scope paginated
 * results, all access-scoped inside GlobalSearchRepository.
 */
import type { GlobalSearchRepository } from '../repositories/globalSearchRepository';
import type { MessageRepository } from '../repositories/messageRepository';
import type { UserRepository } from '../repositories/userRepository';
import type { AuthUser } from '../types';
import type {
  GlobalSearchFilters,
  SearchGroupResult,
  SearchOverviewGroups,
  SearchScope,
} from '../types/Search';
import type { MessageSearchFilters, MessageRow, UserRow } from '../types';

export class SearchService {
  constructor(
    private messageRepository: MessageRepository,
    private userRepository: UserRepository,
    private globalSearchRepository: GlobalSearchRepository,
  ) {}

  async searchMessages(userId: number, search: string, filters: MessageSearchFilters = {}): Promise<MessageRow[]> {
    const { conversation_id, page = 1, limit = 20 } = filters;
    return this.messageRepository.search(userId, search, {
      conversation_id,
      page: parseInt(String(page)),
      limit: parseInt(String(limit)),
    });
  }

  async searchUsers(companyId: number, search: string, limit = 20): Promise<UserRow[]> {
    return this.userRepository.search(companyId, search, limit);
  }

  /** The current user's search context (company + role) for scoped queries. */
  private ctxOf(user: AuthUser) {
    return { userId: user.id, companyId: user.companyId, role: user.role };
  }

  /**
   * Global search overview — top hits (default 5) per scope plus the total
   * match count of every scope. Runs all scopes in parallel.
   */
  async globalOverview(user: AuthUser, filters: GlobalSearchFilters): Promise<SearchOverviewGroups> {
    const ctx = this.ctxOf(user);
    const LIMIT = 5;
    const [messages, people, teams, channels, files, meetings, tasks] = await Promise.all([
      this.globalSearchRepository.searchMessages(ctx, filters, 1, LIMIT),
      this.globalSearchRepository.searchPeople(ctx, filters, 1, LIMIT),
      this.globalSearchRepository.searchTeams(ctx, filters, 1, LIMIT),
      this.globalSearchRepository.searchChannels(ctx, filters, 1, LIMIT),
      this.globalSearchRepository.searchFiles(ctx, filters, 1, LIMIT),
      this.globalSearchRepository.searchMeetings(ctx, filters, 1, LIMIT),
      this.globalSearchRepository.searchTasks(ctx, filters, 1, LIMIT),
    ]);
    return { messages, people, teams, channels, files, meetings, tasks };
  }

  /** Full paginated results for one scope (the "See all N" expansion). */
  async searchScope(
    user: AuthUser,
    scope: SearchScope,
    filters: GlobalSearchFilters,
    page = 1,
    limit = 20,
  ): Promise<SearchGroupResult<unknown>> {
    const ctx = this.ctxOf(user);
    switch (scope) {
      case 'messages':
        return this.globalSearchRepository.searchMessages(ctx, filters, page, limit);
      case 'people':
        return this.globalSearchRepository.searchPeople(ctx, filters, page, limit);
      case 'teams':
        return this.globalSearchRepository.searchTeams(ctx, filters, page, limit);
      case 'channels':
        return this.globalSearchRepository.searchChannels(ctx, filters, page, limit);
      case 'files':
        return this.globalSearchRepository.searchFiles(ctx, filters, page, limit);
      case 'meetings':
        return this.globalSearchRepository.searchMeetings(ctx, filters, page, limit);
      case 'tasks':
        return this.globalSearchRepository.searchTasks(ctx, filters, page, limit);
      default:
        throw new Error(`Unknown search scope: ${String(scope)}`);
    }
  }
}
