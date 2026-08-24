/**
 * BookmarkService — business logic for message bookmarks.
 */
import type { BookmarkRepository } from '../repositories/bookmarkRepository';
import type { MessageRepository } from '../repositories/messageRepository';
import type { ConversationRepository } from '../repositories/conversationRepository';
import type { BookmarkRow } from '../types';

export class BookmarkService {
  constructor(
    private bookmarkRepository: BookmarkRepository,
    private messageRepository: MessageRepository,
    private conversationRepository: ConversationRepository,
  ) {}

  private async assertConversationAccess(
    conversationId: number,
    userId: number,
  ): Promise<void> {
    const conversation = await this.conversationRepository.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    if (conversation.type === 'team') {
      const ok = await this.conversationRepository.canAccessTeamConversation(
        conversation.name || '',
        userId,
      );
      if (!ok) {
        throw new Error('You must be a member of this team to access this conversation');
      }
      return;
    }
    const isMember = await this.conversationRepository.isMember(conversationId, userId);
    if (!isMember) {
      throw new Error('You are not a member of this conversation');
    }
  }

  async bookmark(messageId: number, userId: number): Promise<BookmarkRow> {
    const message = await this.messageRepository.findById(messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    await this.assertConversationAccess(message.conversation_id, userId);

    const id = await this.bookmarkRepository.create({
      message_id: messageId,
      user_id: userId,
    });

    const bookmarks = await this.bookmarkRepository.findByMessage(messageId);
    return bookmarks.find((b) => b.id === id) || bookmarks[0];
  }

  async unbookmark(messageId: number, userId: number): Promise<{ removed: boolean }> {
    const message = await this.messageRepository.findById(messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    await this.assertConversationAccess(message.conversation_id, userId);

    const removed = await this.bookmarkRepository.remove(messageId, userId);
    return { removed };
  }

  async getUserBookmarks(userId: number, page = 1, limit = 20): Promise<BookmarkRow[]> {
    return this.bookmarkRepository.findByUser({
      userId,
      page: parseInt(String(page)),
      limit: parseInt(String(limit)),
    });
  }

  async isBookmarked(messageId: number, userId: number): Promise<boolean> {
    return this.bookmarkRepository.exists(messageId, userId);
  }
}
