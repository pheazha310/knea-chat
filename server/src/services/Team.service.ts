/**
 * TeamService — business logic for teams and team members.
 */
import type { TeamRepository } from '../repositories/teamRepository';
import type { TeamMemberRepository } from '../repositories/teamMemberRepository';
import type { ConversationRepository } from '../repositories/conversationRepository';
import { ROLES, isAtLeast } from '../utils/roles';
import type { PermissionPolicy } from './Permission.service';
import type { PermissionKey } from '../utils/permissions';
import type { AuthUser, TeamRow } from '../types';

export class TeamService {
  constructor(
    private teamRepository: TeamRepository,
    private teamMemberRepository: TeamMemberRepository,
    private conversationRepository: ConversationRepository,
    /** Optional: per-company permission overrides (Administration module). */
    private permissionPolicy?: PermissionPolicy | null,
  ) {}

  /** Effective capability answer (absent policy = baseline hierarchy). */
  private async can(requester: AuthUser, permissionKey: PermissionKey): Promise<boolean> {
    if (!this.permissionPolicy) return true;
    return this.permissionPolicy.allows(requester.companyId, requester.role, permissionKey);
  }

  async getTeams(filters: {
    companyId: number;
    page?: number;
    limit?: number;
    search?: string;
    requesterId?: number;
  }): Promise<{ teams: TeamRow[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const { companyId, page = 1, limit = 20, search = '', requesterId } = filters;

    const teams = await this.teamRepository.findAll({
      companyId,
      page: parseInt(String(page)),
      limit: parseInt(String(limit)),
      search,
      requesterId,
    });

    const total = await this.teamRepository.countByCompany(companyId);

    return {
      teams,
      pagination: {
        page: parseInt(String(page)),
        limit: parseInt(String(limit)),
        total,
        totalPages: Math.ceil(total / parseInt(String(limit))),
      },
    };
  }

  async getTeam(id: number): Promise<TeamRow> {
    const team = await this.teamRepository.findById(id);
    if (!team) {
      throw new Error('Team not found');
    }
    return team;
  }

  async createTeam(data: {
    company_id: number;
    name: string;
    description?: string | null;
    created_by: number;
    department_id?: number | null;
    /** Optional pre-selected members added at creation (the creator may staff their own team). */
    member_ids?: number[];
  }): Promise<TeamRow> {
    const { company_id, name, description, created_by, department_id, member_ids } = data;

    const teamId = await this.teamRepository.create({
      company_id,
      name,
      description,
      created_by,
      department_id,
    });

    await this.teamMemberRepository.add(teamId, created_by, 'leader');

    for (const userId of member_ids || []) {
      const uid = Number(userId);
      if (!Number.isInteger(uid) || uid === created_by) continue;
      if (await this.teamMemberRepository.isMember(teamId, uid)) continue;
      await this.teamMemberRepository.add(teamId, uid, 'member');
    }

    const team = await this.teamRepository.findById(teamId);
    if (!team) throw new Error('Team not found');
    return team;
  }

  async updateTeam(id: number, data: Record<string, unknown>, requester: AuthUser | null = null): Promise<TeamRow> {
    const team = await this.teamRepository.findById(id);
    if (!team) {
      throw new Error('Team not found');
    }

    await this.assertCanManageTeam(team, requester);

    const updated = await this.teamRepository.update(id, data);
    if (!updated) {
      throw new Error('Failed to update team');
    }

    const refreshed = await this.teamRepository.findById(id);
    if (!refreshed) throw new Error('Team not found');
    return refreshed;
  }

  async deleteTeam(id: number, requester: AuthUser | null = null): Promise<{ message: string }> {
    const team = await this.teamRepository.findById(id);
    if (!team) {
      throw new Error('Team not found');
    }

    await this.assertCanManageTeam(team, requester);

    const deleted = await this.teamRepository.delete(id);
    if (!deleted) {
      throw new Error('Failed to delete team');
    }

    return { message: 'Team deleted successfully' };
  }

  async addMember(
    teamId: number,
    userId: number,
    role = 'member',
    requester: AuthUser | null = null,
  ): Promise<{ message: string }> {
    const team = await this.teamRepository.findById(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    await this.assertCanManageMembers(team, requester);

    const isMember = await this.teamMemberRepository.isMember(teamId, userId);
    if (isMember) {
      throw new Error('User is already a member of this team');
    }

    await this.teamMemberRepository.add(teamId, userId, role);
    await this.syncConversationMembership(team, userId, 'add');
    return { message: 'Member added successfully' };
  }

  async removeMember(
    teamId: number,
    userId: number,
    requester: AuthUser | null = null,
  ): Promise<{ message: string }> {
    const team = await this.teamRepository.findById(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    await this.assertCanManageMembers(team, requester);

    const removed = await this.teamMemberRepository.remove(teamId, userId);
    if (!removed) {
      throw new Error('User is not a member of this team');
    }

    await this.syncConversationMembership(team, userId, 'remove');
    return { message: 'Member removed successfully' };
  }

  async getTeamMembers(teamId: number): Promise<unknown[]> {
    const team = await this.teamRepository.findById(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    return this.teamMemberRepository.findMembers(teamId);
  }

  /**
   * Mirror team membership onto the team's conversation members, so a member
   * can write (and receive) messages immediately and a removed member loses
   * access. The conversation backing a team is matched by type+name (same
   * convention the client uses); if it doesn't exist yet, nothing to do.
   */
  private async syncConversationMembership(
    team: TeamRow,
    userId: number,
    action: 'add' | 'remove',
  ): Promise<void> {
    try {
      const conversation = await this.conversationRepository.findTeamConversation(team.name);
      if (!conversation) return;
      if (action === 'add') {
        if (await this.conversationRepository.isMember(conversation.id, userId)) return;
        await this.conversationRepository.addMember(conversation.id, userId, 'member');
      } else {
        await this.conversationRepository.removeMember(conversation.id, userId);
      }
    } catch (error) {
      console.error(`[team] Could not sync conversation membership for team ${team.id}:`, (error as Error).message);
    }
  }

  /**
   * Who may manage a team (SRS §7, §19, role matrix):
   *   - admins & super admins: every team in the company (platform-wide)
   *   - managers: only the teams they are assigned to (a member of)
   *   - the team creator: their own team (details)
   * Regular team members (employees) cannot manage the team.
   */
  async assertCanManageTeam(team: TeamRow, requester: AuthUser | null): Promise<void> {
    if (!requester) return;
    const { id: requesterId, role } = requester;

    if (isAtLeast(role, ROLES.ADMIN)) return;

    if (Number(team.created_by) === Number(requesterId)) return;

    const teamRole = await this.teamMemberRepository.getRole(team.id, requesterId);

    // Managers manage only the teams they are assigned to (a Company Admin
    // may restrict this via the permissions console).
    if (role === ROLES.MANAGER && teamRole) {
      if (await this.can(requester, 'manage_teams')) return;
    }

    throw new Error('You do not have permission to manage this team');
  }

  /**
   * Who may add/remove team members (role matrix — "Manage team members"):
   *   - admins & super admins: every team in the company
   *   - managers: only the teams they are assigned to
   *   - the team creator: their own team
   * Other employees (incl. team leaders who are not the creator) cannot.
   */
  async assertCanManageMembers(team: TeamRow, requester: AuthUser | null): Promise<void> {
    if (!requester) return;
    const { id: requesterId, role } = requester;

    if (isAtLeast(role, ROLES.ADMIN)) return;

    // The team creator may staff their own team.
    if (Number(team.created_by) === Number(requesterId)) return;

    const teamRole = await this.teamMemberRepository.getRole(team.id, requesterId);

    if (role === ROLES.MANAGER && teamRole) {
      if (await this.can(requester, 'manage_team_members')) return;
    }

    throw new Error('You do not have permission to manage team members');
  }
}
