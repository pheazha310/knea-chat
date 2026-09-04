'use strict';

/**
 * PermissionService — discretionary permission management.
 *   - admins / super admins always keep every capability
 *   - absent override → baseline role hierarchy decides
 *   - a stored override pins a capability on/off for a company role
 *   - setOverride refuses to restrict administrators or non-restrictable roles
 *   - TeamService / ChannelService consult the policy (4th/5th ctor arg) so a
 *     company restriction actually blocks manager actions
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PermissionService } from '../src/services/Permission.service';
import { TeamService } from '../src/services/Team.service';
import { ChannelService } from '../src/services/Channel.service';
import type { RolePermissionRepository } from '../src/repositories/rolePermissionRepository';
import type { TeamRepository } from '../src/repositories/teamRepository';
import type { TeamMemberRepository } from '../src/repositories/teamMemberRepository';
import type { ConversationRepository } from '../src/repositories/conversationRepository';
import type { ChannelRepository } from '../src/repositories/channelRepository';
import type { ChannelMemberRepository } from '../src/repositories/channelMemberRepository';
import type { RolePermissionRow, TeamRow, ChannelRow, AuthUser } from '../src/types';

const rolePermissionRepository = {
  findByCompany: async () => [] as RolePermissionRow[],
  findByKey: async () => null as RolePermissionRow | null,
  upsert: async () => undefined,
  remove: async () => undefined,
};

const permissionService = new PermissionService(
  rolePermissionRepository as unknown as RolePermissionRepository,
);

describe('PermissionService.allows', () => {
  it('always lets admins and super admins perform a capability', async (t) => {
    const findByKey = t.mock.method(rolePermissionRepository, 'findByKey', async () => null);
    assert.equal(await permissionService.allows(1, 'super_admin', 'create_teams'), true);
    assert.equal(await permissionService.allows(1, 'admin', 'publish_announcements'), true);
    assert.equal(findByKey.mock.calls.length, 0); // admins short-circuit
  });

  it('uses the baseline hierarchy when no override is stored', async (t) => {
    t.mock.method(rolePermissionRepository, 'findByKey', async () => null);
    assert.equal(await permissionService.allows(1, 'manager', 'create_teams'), true); // manager ≥ manager
    assert.equal(await permissionService.allows(1, 'employee', 'create_teams'), false); // employee < manager
  });

  it('honors a stored override that pins a capability off', async (t) => {
    t.mock.method(rolePermissionRepository, 'findByKey', async () => ({
      company_id: 1, role: 'manager', permission_key: 'create_teams', allowed: 0, updated_by: 5, updated_at: '2026-09-01T10:00:00Z',
    }));
    assert.equal(await permissionService.allows(1, 'manager', 'create_teams'), false);
  });
});

describe('PermissionService.getMatrix', () => {
  it('returns one row per capability × company role with baseline + overrides', async (t) => {
    t.mock.method(rolePermissionRepository, 'findByCompany', async () => [
      { company_id: 1, role: 'manager', permission_key: 'manage_teams', allowed: 0, updated_by: 5, updated_at: '2026-09-01T10:00:00Z' },
    ]);

    const matrix = await permissionService.getMatrix(1);

    // 5 catalog capabilities × 3 company roles (admin/manager/employee)
    assert.equal(matrix.length, 15);

    const adminCell = matrix.find((m) => m.permission_key === 'create_teams' && m.role === 'admin');
    assert.equal(adminCell?.allowed, true);
    assert.equal(adminCell?.restrictable, false);

    const managerOverride = matrix.find((m) => m.permission_key === 'manage_teams' && m.role === 'manager');
    assert.equal(managerOverride?.allowed, false);
    assert.equal(managerOverride?.is_override, true);
    assert.equal(managerOverride?.restrictable, true);

    const employeeCell = matrix.find((m) => m.permission_key === 'publish_announcements' && m.role === 'employee');
    assert.equal(employeeCell?.allowed, false);
    assert.equal(employeeCell?.restrictable, false);
  });
});

describe('PermissionService.setOverride / resetOverride', () => {
  it('pins a capability off for the manager role', async (t) => {
    const upsert = t.mock.method(rolePermissionRepository, 'upsert', async () => undefined);
    const row = await permissionService.setOverride(1, 'manager', 'manage_teams', false, 5);
    assert.equal(row.allowed, false);
    assert.deepEqual(upsert.mock.calls[0].arguments, [1, 'manager', 'manage_teams', false, 5]);
  });

  it('refuses to restrict administrators', async (t) => {
    const upsert = t.mock.method(rolePermissionRepository, 'upsert', async () => undefined);
    await assert.rejects(
      permissionService.setOverride(1, 'admin', 'manage_teams', false, 5),
      /Administrator permissions cannot be restricted/,
    );
    assert.equal(upsert.mock.calls.length, 0);
  });

  it('refuses to restrict a role the catalog does not expose', async (t) => {
    await assert.rejects(
      permissionService.setOverride(1, 'employee', 'create_teams', false, 5),
      /cannot be changed for the employee role/,
    );
  });

  it('rejects an unknown permission key', async (t) => {
    await assert.rejects(
      permissionService.setOverride(1, 'manager', 'explode_company' as never, false, 5),
      /Unknown permission "explode_company"/,
    );
  });

  it('removes an override to fall back to the baseline', async (t) => {
    const remove = t.mock.method(rolePermissionRepository, 'remove', async () => undefined);
    await permissionService.resetOverride(1, 'manager', 'manage_teams');
    assert.deepEqual(remove.mock.calls[0].arguments, [1, 'manager', 'manage_teams']);
  });
});

/* ------------------------------------------------------------------------ */
/* Enforcement: TeamService / ChannelService consult the injected policy     */
/* ------------------------------------------------------------------------ */

const requester = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: 9,
  email: 'dara@kneachat.com',
  role: 'manager',
  companyId: 1,
  ...overrides,
});

const teamRepository = {
  findById: async () => null as TeamRow | null,
};
const teamMemberRepository = {
  getRole: async () => 'member' as string | null,
  add: async () => 1,
  remove: async () => true,
  isMember: async () => false,
};
const conversationRepository = {
  findTeamConversation: async () => null,
  isMember: async () => false,
  addMember: async () => 1,
  removeMember: async () => true,
};

const makeTeam = (overrides: Partial<TeamRow> = {}): TeamRow => ({
  id: 3,
  company_id: 1,
  department_id: null,
  name: 'Engineering',
  description: null,
  created_by: 7,
  created_at: '2026-08-17T10:00:00Z',
  updated_at: '2026-08-17T10:00:00Z',
  ...overrides,
});

describe('TeamService consults the permission policy', () => {
  it('allows a manager with membership when the company has not restricted manage_teams', async (t) => {
    const policy = { allows: async () => true };
    t.mock.method(teamRepository, 'findById', async () => makeTeam());
    t.mock.method(teamMemberRepository, 'getRole', async () => 'leader');

    const teamService = new TeamService(
      teamRepository as unknown as TeamRepository,
      teamMemberRepository as unknown as TeamMemberRepository,
      conversationRepository as unknown as ConversationRepository,
      policy,
    );
    await teamService.assertCanManageTeam(makeTeam(), requester()); // resolves
  });

  it('blocks a manager from managing assigned teams when the company restricted the capability', async (t) => {
    const policy = { allows: async () => false };
    t.mock.method(teamRepository, 'findById', async () => makeTeam());
    t.mock.method(teamMemberRepository, 'getRole', async () => 'leader');

    const teamService = new TeamService(
      teamRepository as unknown as TeamRepository,
      teamMemberRepository as unknown as TeamMemberRepository,
      conversationRepository as unknown as ConversationRepository,
      policy,
    );
    await assert.rejects(
      teamService.assertCanManageTeam(makeTeam(), requester()),
      /do not have permission to manage this team/,
    );
  });

  it('never restricts admins even when the policy denies', async (t) => {
    const policy = { allows: async () => false };
    t.mock.method(teamRepository, 'findById', async () => makeTeam());

    const teamService = new TeamService(
      teamRepository as unknown as TeamRepository,
      teamMemberRepository as unknown as TeamMemberRepository,
      conversationRepository as unknown as ConversationRepository,
      policy,
    );
    await teamService.assertCanManageTeam(makeTeam(), requester({ role: 'admin' })); // resolves
  });

  it('blocks member management for managers when manage_team_members is restricted', async (t) => {
    const policy = { allows: async () => false };
    t.mock.method(teamRepository, 'findById', async () => makeTeam());
    t.mock.method(teamMemberRepository, 'getRole', async () => 'leader');

    const teamService = new TeamService(
      teamRepository as unknown as TeamRepository,
      teamMemberRepository as unknown as TeamMemberRepository,
      conversationRepository as unknown as ConversationRepository,
      policy,
    );
    await assert.rejects(
      teamService.assertCanManageMembers(makeTeam(), requester()),
      /do not have permission to manage team members/,
    );
  });
});

describe('ChannelService consults the permission policy', () => {
  const channelRepository = {
    findById: async () => null as ChannelRow | null,
  };
  const channelMemberRepository = {
    getRole: async () => 'member' as string | null,
  };

  const makeChannel = (overrides: Partial<ChannelRow> = {}): ChannelRow => ({
    id: 4,
    company_id: 1,
    team_id: 3,
    created_by: 7,
    name: 'general',
    description: null,
    type: 'public',
    is_archived: 0,
    created_at: '2026-08-17T10:00:00Z',
    updated_at: '2026-08-17T10:00:00Z',
    ...overrides,
  });

  it('blocks a manager from managing team channels when manage_channels is restricted', async (t) => {
    const policy = { allows: async () => false };
    t.mock.method(channelRepository, 'findById', async () => makeChannel());
    t.mock.method(channelMemberRepository, 'getRole', async () => 'member');
    t.mock.method(teamMemberRepository, 'getRole', async () => 'leader');

    const channelService = new ChannelService(
      channelRepository as unknown as ChannelRepository,
      channelMemberRepository as unknown as ChannelMemberRepository,
      teamMemberRepository as unknown as TeamMemberRepository,
      conversationRepository as unknown as ConversationRepository,
      policy,
    );
    await assert.rejects(
      channelService.assertCanManageChannel(makeChannel(), requester()),
      /do not have permission to manage this channel/,
    );
  });

  it('lets the channel creator manage their channel regardless of the policy', async (t) => {
    const policy = { allows: async () => false };
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ created_by: 9 }));

    const channelService = new ChannelService(
      channelRepository as unknown as ChannelRepository,
      channelMemberRepository as unknown as ChannelMemberRepository,
      teamMemberRepository as unknown as TeamMemberRepository,
      conversationRepository as unknown as ConversationRepository,
      policy,
    );
    await channelService.assertCanManageChannel(makeChannel({ created_by: 9 }), requester()); // resolves
  });
});
