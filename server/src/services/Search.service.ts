/**
 * SearchService — business logic for message and user search.
 */
import type { MessageRepository } from '../repositories/messageRepository';
import type { UserRepository } from '../repositories/userRepository';
import type { MessageSearchFilters, MessageRow, UserRow } from '../types';

export class SearchService {
  constructor(
    private messageRepository: MessageRepository,
    private userRepository: UserRepository,
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
}
