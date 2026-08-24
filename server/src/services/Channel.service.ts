/**
 * ChannelService — business logic for channels and channel members.
 */
import type { ChannelRepository } from '../repositories/channelRepository';
import type { ChannelMemberRepository } from '../repositories/channelMemberRepository';
import type { TeamMemberRepository } from '../repositories/teamMemberRepository';
import type { ConversationRepository } from '../repositories/conversationRepository';
import { ROLES, isAtLeast } from '../utils/roles';
import type { AuthUser, ChannelRow } from '../types';

export class ChannelService {
  constructor(
    private channelRepository: ChannelRepository,
    private channelMemberRepository: ChannelMemberRepository,
    private teamMemberRepository: TeamMemberRepository,
    private conversationRepository: ConversationRepository,
  ) {}

  async getChannels(filters: {
    companyId: number;
    teamId?: number | string;
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<{ channels: ChannelRow[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const { companyId, teamId, page = 1, limit = 20, search = '' } = filters;

    const channels = await this.channelRepository.findAll({
      companyId,
      teamId,
      page: parseInt(String(page)),
      limit: parseInt(String(limit)),
      search,
    });

    return {
      channels,
      pagination: {
        page: parseInt(String(page)),
        limit: parseInt(String(limit)),
        total: channels.length,
        totalPages: Math.ceil(channels.length / parseInt(String(limit))),
      },
    };
  }

  async getChannel(id: number): Promise<ChannelRow> {
    const channel = await this.channelRepository.findById(id);
    if (!channel) {
      throw new Error('Channel not found');
    }
    return channel;
  }

  async createChannel(
    data: {
      company_id: number;
      name: string;
      description?: string | null;
      created_by: number;
      type?: string;
      team_id?: number | null;
      /** Optional pre-selected members added at creation (the creator becomes the channel admin). */
      member_ids?: number[];
    },
    requester: AuthUser | null = null,
  ): Promise<ChannelRow> {
    const { company_id, name, description, created_by, type, team_id, member_ids } = data;

    if (requester) {
      await this.assertCanCreateChannel(team_id ? Number(team_id) : null, requester);
    }

    const channelId = await this.channelRepository.create({
      company_id,
      name,
      description,
      created_by,
      type: type || 'public',
      team_id,
    });

    await this.channelMemberRepository.add(channelId, created_by, 'admin');

    for (const userId of member_ids || []) {
      const uid = Number(userId);
      if (!Number.isInteger(uid) || uid === created_by) continue;
      if (await this.channelMemberRepository.isMember(channelId, uid)) continue;
      await this.channelMemberRepository.add(channelId, uid, 'member');
    }

    const channel = await this.channelRepository.findById(channelId);
    if (!channel) throw new Error('Channel not found');
    return channel;
  }

  async updateChannel(id: number, data: Record<string, unknown>, requester: AuthUser | null = null): Promise<ChannelRow> {
    const channel = await this.channelRepository.findById(id);
    if (!channel) {
      throw new Error('Channel not found');
    }

    await this.assertCanManageChannel(channel, requester);

    const updated = await this.channelRepository.update(id, data);
    if (!updated) {
      throw new Error('Failed to update channel');
    }

    const refreshed = await this.channelRepository.findById(id);
    if (!refreshed) throw new Error('Channel not found');
    return refreshed;
  }

  async deleteChannel(id: number, requester: AuthUser | null = null): Promise<{ message: string }> {
    const channel = await this.channelRepository.findById(id);
    if (!channel) {
      throw new Error('Channel not found');
    }

    await this.assertCanManageChannel(channel, requester);

    const deleted = await this.channelRepository.delete(id);
    if (!deleted) {
      throw new Error('Failed to delete channel');
    }

    return { message: 'Channel deleted successfully' };
  }

  async addMember(
    channelId: number,
    userId: number,
    role = 'member',
    requester: AuthUser | null = null,
  ): Promise<{ message: string }> {
    const channel = await this.channelRepository.findById(channelId);
    if (!channel) {
      throw new Error('Channel not found');
    }

    await this.assertCanManageChannel(channel, requester);

    const isMember = await this.channelMemberRepository.isMember(channelId, userId);
    if (isMember) {
      throw new Error('User is already a member of this channel');
    }

    await this.channelMemberRepository.add(channelId, userId, role);
    await this.syncConversationMembership(channel, userId, 'add');
    return { message: 'Member added successfully' };
  }

  async removeMember(
    channelId: number,
    userId: number,
    requester: AuthUser | null = null,
  ): Promise<{ message: string }> {
    const channel = await this.channelRepository.findById(channelId);
    if (!channel) {
      throw new Error('Channel not found');
    }

    await this.assertCanManageChannel(channel, requester);

    const removed = await this.channelMemberRepository.remove(channelId, userId);
    if (!removed) {
      throw new Error('User is not a member of this channel');
    }

    await this.syncConversationMembership(channel, userId, 'remove');
    return { message: 'Member removed successfully' };
  }

  /**
   * Mirror channel membership onto the channel's conversation members, so a
   * member can write (and receive) messages immediately and a removed member
   * loses access. The conversation backing a channel is matched by type+name
   * (same convention the client uses); if it doesn't exist yet, nothing to do.
   */
  private async syncConversationMembership(
    channel: ChannelRow,
    userId: number,
    action: 'add' | 'remove',
  ): Promise<void> {
    try {
      const conversation = await this.conversationRepository.findChannelConversation(channel.name);
      if (!conversation) return;
      if (action === 'add') {
        if (await this.conversationRepository.isMember(conversation.id, userId)) return;
        await this.conversationRepository.addMember(conversation.id, userId, 'member');
      } else {
        await this.conversationRepository.removeMember(conversation.id, userId);
      }
    } catch (error) {
      console.error(`[channel] Could not sync conversation membership for channel ${channel.id}:`, (error as Error).message);
    }
  }

  async getChannelMembers(channelId: number): Promise<unknown[]> {
    const channel = await this.channelRepository.findById(channelId);
    if (!channel) {
      throw new Error('Channel not found');
    }

    return this.channelMemberRepository.findMembers(channelId);
  }

  async getUserChannels(userId: number, companyId: number): Promise<ChannelRow[]> {
    return this.channelRepository.findByUser(userId, companyId);
  }

  /**
   * Who may create a channel (role matrix):
   *   - admins & super admins: anywhere in the company
   *   - managers: standalone channels, or channels inside teams they manage
   *   - employees: only inside a team they are a member of
   */
  async assertCanCreateChannel(teamId: number | null, requester: AuthUser): Promise<void> {
    if (isAtLeast(requester.role, ROLES.ADMIN)) return;

    if (requester.role === ROLES.MANAGER) {
      if (teamId === null) return;
      const teamRole = await this.teamMemberRepository.getRole(teamId, requester.id);
      if (teamRole) return;
      throw new Error('You do not have permission to create a channel in this team');
    }

    // Employees may create channels only inside a team they belong to.
    if (teamId === null) {
      throw new Error('Only managers can create standalone channels');
    }
    const teamRole = await this.teamMemberRepository.getRole(teamId, requester.id);
    if (teamRole) return;

    throw new Error('You do not have permission to create a channel in this team');
  }

  /**
   * Who may manage a channel (SRS §7, §19):
   *   - admins & super admins: every channel in the company (platform-wide)
   *   - the channel creator: their own channel
   *   - channel admins: their channel
   *   - managers: channels inside the teams they are assigned to
   * Plain members and unassigned managers cannot manage a channel.
   */
  async assertCanManageChannel(channel: ChannelRow, requester: AuthUser | null): Promise<void> {
    if (!requester) return;
    const { id: requesterId, role } = requester;

    if (isAtLeast(role, ROLES.ADMIN)) return;
    if (Number(channel.created_by) === Number(requesterId)) return;

    const channelRole = await this.channelMemberRepository.getRole(channel.id, requesterId);
    if (channelRole === 'admin') return;

    // Managers manage the channels inside the teams they are assigned to.
    if (role === ROLES.MANAGER && channel.team_id) {
      const teamRole = await this.teamMemberRepository.getRole(channel.team_id, requesterId);
      if (teamRole) return;
    }

    throw new Error('You do not have permission to manage this channel');
  }
}
