/**
 * ConversationService — business logic for conversations (direct, group,
 * channel) and their members.
 */
import type { ConversationRepository } from '../repositories/conversationRepository';
import type { MessageRepository } from '../repositories/messageRepository';
import type { UserRepository } from '../repositories/userRepository';
import type { ChannelRepository } from '../repositories/channelRepository';
import type { ChannelMemberRepository } from '../repositories/channelMemberRepository';
import type { TeamRepository } from '../repositories/teamRepository';
import type { TeamMemberRepository } from '../repositories/teamMemberRepository';
import type { Conversation, ConversationRow } from '../types';

export class ConversationService {
  constructor(
    private conversationRepository: ConversationRepository,
    private messageRepository: MessageRepository,
    private userRepository: UserRepository,
    private channelRepository: ChannelRepository,
    private channelMemberRepository: ChannelMemberRepository,
    private teamRepository: TeamRepository,
    private teamMemberRepository: TeamMemberRepository,
  ) {}

  async getConversations(filters: {
    userId: number;
    page?: number;
    limit?: number;
    type?: string;
  }): Promise<{ conversations: Conversation[]; pagination: { page: number; limit: number; total: number } }> {
    const { userId, page = 1, limit = 20, type = '' } = filters;
    const conversations = (await this.conversationRepository.findAll({
      userId,
      page: parseInt(String(page)),
      limit: parseInt(String(limit)),
      type,
    })) as Conversation[];

    // Team conversations are restricted to team members + privileged roles.
    // Drop stale ones (e.g. auto-joined before the restriction shipped) so
    // former members can't see them in the list even if their old
    // conversation_members row is still around.
    const accessible: Conversation[] = [];
    for (const conv of conversations) {
      if (conv.type === 'team') {
        const ok = await this.conversationRepository.canAccessTeamConversation(
          conv.name || '',
          userId,
        );
        if (!ok) continue;
      }
      accessible.push(conv);
    }

    for (const conv of accessible) {
      conv.members = await this.conversationRepository.findMembers(conv.id);
    }

    return {
      conversations: accessible,
      pagination: {
        page: parseInt(String(page)),
        limit: parseInt(String(limit)),
        total: accessible.length,
      },
    };
  }

  /**
   * Authorization rule for conversation access. Team conversations are
   * restricted to team members + privileged roles (super_admin / admin /
   * manager); every other conversation type requires conversation membership.
   */
  private async assertCanAccess(
    conversation: ConversationRow,
    userId: number,
  ): Promise<void> {
    if (conversation.type === 'team') {
      const ok = await this.conversationRepository.canAccessTeamConversation(
        conversation.name || '',
        userId,
      );
      if (!ok) {
        throw new Error('You must be a member of this team to access its conversation');
      }
      return;
    }
    const isMember = await this.conversationRepository.isMember(conversation.id, userId);
    if (!isMember) {
      throw new Error('You are not a member of this conversation');
    }
  }

  async getConversation(id: number, userId: number | null = null): Promise<ConversationRow> {
    const conversation = await this.conversationRepository.findById(id);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    if (userId) {
      await this.assertCanAccess(conversation, userId);
    }
    return conversation;
  }

  async createConversation(data: {
    type: string;
    created_by: number;
    name?: string | null;
    description?: string | null;
    participant_ids?: number[];
    /** Scopes channel/team-member auto-join to one company (no cross-company leaks). */
    company_id?: number;
  }): Promise<Conversation> {
    const { type, created_by, name, description, participant_ids = [], company_id } = data;

    // Team conversations are restricted: only team members (plus
    // managers/admins/super admins) may open (create/join) them. The check
    // runs before any row is created or joined.
    if (type === 'team') {
      if (!name) {
        throw new Error('Team conversations require a team name');
      }
      const ok = await this.conversationRepository.canAccessTeamConversation(name, created_by);
      if (!ok) {
        throw new Error('You must be a member of this team to open its conversation');
      }
    }

    // Channel/team conversations are created on-demand when a member first
    // opens the channel/team. If one already exists (same type + name within
    // the same company), reuse it and join the creator + every current
    // channel/team member instead of duplicating the row.
    if ((type === 'channel' || type === 'team') && name) {
      const existing = (type === 'team'
        ? await this.conversationRepository.findTeamConversation(name, company_id)
        : await this.conversationRepository.findChannelConversation(name, company_id)) as Conversation | null;
      if (existing) {
        // Join the creator only if they're not already a member — addMember is
        // a raw INSERT, so re-joining an existing member violates the unique
        // conversation_members key.
        if (!(await this.conversationRepository.isMember(existing.id, created_by))) {
          await this.conversationRepository.addMember(existing.id, created_by, 'member');
        }
        if (type === 'team') {
          await this.autoJoinTeamMembers(existing.id, name, company_id);
        } else {
          await this.autoJoinChannelMembers(existing.id, name, company_id);
        }
        existing.members = await this.conversationRepository.findMembers(existing.id);
        return existing;
      }
    }

    const conversationId = await this.conversationRepository.create({
      type,
      created_by,
      name,
      description,
    });

    await this.conversationRepository.addMember(conversationId, created_by, 'admin');

    for (const participantId of participant_ids) {
      await this.conversationRepository.addMember(conversationId, participantId, 'member');
    }

    // Channel conversations: auto-join every current channel member so they
    // can write and receive messages immediately (not just whoever opened it
    // first).
    if (type === 'channel' && name && company_id) {
      await this.autoJoinChannelMembers(conversationId, name, company_id);
    }

    // Team conversations: auto-join every current team member so the whole
    // team can write and receive messages immediately.
    if (type === 'team' && name && company_id) {
      await this.autoJoinTeamMembers(conversationId, name, company_id);
    }

    const conversation = (await this.conversationRepository.findById(conversationId)) as Conversation;
    conversation.members = await this.conversationRepository.findMembers(conversationId);

    return conversation;
  }

  /**
   * Join every member of the channel(s) matching `name` in `companyId` into a
   * conversation. Best-effort: membership failures never block creation.
   */
  private async autoJoinChannelMembers(
    conversationId: number,
    name: string,
    companyId?: number,
  ): Promise<void> {
    if (!companyId) return;
    try {
      const channels = await this.channelRepository.findByName(name, companyId);
      for (const channel of channels) {
        const memberIds = await this.channelMemberRepository.findMemberIds(channel.id);
        for (const memberId of memberIds) {
          if (await this.conversationRepository.isMember(conversationId, memberId)) continue;
          await this.conversationRepository.addMember(conversationId, memberId, 'member');
        }
      }
    } catch (error) {
      console.error(`[conversation] Could not auto-join channel members for conversation ${conversationId}:`, (error as Error).message);
    }
  }

  /**
   * Join every member of the team(s) matching `name` in `companyId` into a
   * conversation. Best-effort: membership failures never block creation.
   */
  private async autoJoinTeamMembers(
    conversationId: number,
    name: string,
    companyId?: number,
  ): Promise<void> {
    if (!companyId) return;
    try {
      const teams = await this.teamRepository.findByName(name, companyId);
      for (const team of teams) {
        const memberIds = await this.teamMemberRepository.findMemberIds(team.id);
        for (const memberId of memberIds) {
          if (await this.conversationRepository.isMember(conversationId, memberId)) continue;
          await this.conversationRepository.addMember(conversationId, memberId, 'member');
        }
      }
    } catch (error) {
      console.error(`[conversation] Could not auto-join team members for conversation ${conversationId}:`, (error as Error).message);
    }
  }

  async addMember(
    conversationId: number,
    userId: number,
    requesterId: number | null = null,
  ): Promise<{ message: string }> {
    const conversation = await this.conversationRepository.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Team conversation membership is driven by team membership (TeamService
    // syncs it on add/remove). Nobody may manually add another user; an
    // authorized user may only self-join (the flow that runs when they open
    // the team for the first time).
    if (conversation.type === 'team') {
      if (!requesterId || Number(requesterId) !== Number(userId)) {
        throw new Error('Team conversation members are managed through the team');
      }
      const ok = await this.conversationRepository.canAccessTeamConversation(
        conversation.name || '',
        requesterId,
      );
      if (!ok) {
        throw new Error('You must be a member of this team to access its conversation');
      }
    }

    const isMember = await this.conversationRepository.isMember(conversationId, userId);
    if (isMember) {
      throw new Error('User is already a member of this conversation');
    }

    await this.conversationRepository.addMember(conversationId, userId, 'member');
    return { message: 'Member added successfully' };
  }

  async getMessages(conversationId: number, page = 1, limit = 30, userId: number | null = null): Promise<unknown[]> {
    const conversation = await this.conversationRepository.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    if (userId) {
      await this.assertCanAccess(conversation, userId);
    }

    const messages = await this.messageRepository.findAll({
      conversationId,
      page: parseInt(String(page)),
      limit: parseInt(String(limit)),
    });

    for (const message of messages) {
      (message as { reactions?: unknown[] }).reactions = await this.messageRepository.findReactions(message.id);
      (message as { attachments?: unknown[] }).attachments = await this.messageRepository.findAttachments(message.id);
    }

    return messages;
  }

  async findOrCreateDirectConversation(userId1: number, userId2: number): Promise<Conversation> {
    const existingId = await this.conversationRepository.findDirectConversation(userId1, userId2);
    if (existingId) {
      const conversation = (await this.conversationRepository.findById(existingId)) as Conversation;
      conversation.members = await this.conversationRepository.findMembers(existingId);
      return conversation;
    }

    const user1 = await this.userRepository.findById(userId1);
    const user2 = await this.userRepository.findById(userId2);
    if (!user1 || !user2) {
      throw new Error('User not found');
    }
    const name = `${user1.first_name} ${user1.last_name} - ${user2.first_name} ${user2.last_name}`;

    const conversationId = await this.conversationRepository.create({
      type: 'direct',
      created_by: userId1,
      name,
      description: 'Direct conversation',
    });

    await this.conversationRepository.addMember(conversationId, userId1, 'member');
    await this.conversationRepository.addMember(conversationId, userId2, 'member');

    const conversation = (await this.conversationRepository.findById(conversationId)) as Conversation;
    conversation.members = await this.conversationRepository.findMembers(conversationId);

    return conversation;
  }
}
