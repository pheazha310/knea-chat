'use strict';

/**
 * Scoped team/channel management permissions (role matrix):
 *   - admins & super admins: every team/channel in the company
 *   - creators / team leaders / channel admins: their own team/channel
 *   - managers: only the teams they are assigned to (and channels inside them)
 *   - plain members / unassigned managers: denied
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TeamService } from '../src/services/Team.service';
import { ChannelService } from '../src/services/Channel.service';
import { ConversationService } from '../src/services/Conversation.service';
import type { TeamRepository } from '../src/repositories/teamRepository';
import type { TeamMemberRepository } from '../src/repositories/teamMemberRepository';
import type { ChannelRepository } from '../src/repositories/channelRepository';
import type { ChannelMemberRepository } from '../src/repositories/channelMemberRepository';
import type { ConversationRepository } from '../src/repositories/conversationRepository';
import type { MessageRepository } from '../src/repositories/messageRepository';
import type { UserRepository } from '../src/repositories/userRepository';
import type { AuthUser, ChannelRow, ConversationRow, TeamRow } from '../src/types';

const teamMemberRepository = {
  getRole: async (_teamId: number, _userId: number) => null as string | null,
  add: async () => 1,
  remove: async () => true,
  isMember: async () => false,
  findMemberIds: async () => [] as number[],
};

const teamRepository = {
  findById: async () => null as TeamRow | null,
  create: async () => 1,
  update: async () => true,
  delete: async () => true,
  findByName: async () => [] as TeamRow[],
};

const channelMemberRepository = {
  getRole: async (_channelId: number, _userId: number) => null as string | null,
  add: async () => 1,
  remove: async () => true,
  isMember: async () => false,
  findMemberIds: async () => [] as number[],
};

const channelRepository = {
  findById: async () => null as ChannelRow | null,
  create: async () => 1,
  update: async () => true,
  delete: async () => true,
  findByName: async () => [] as ChannelRow[],
};

const conversationRepository = {
  findById: async () => null as ConversationRow | null,
  findAll: async () => [] as ConversationRow[],
  create: async () => 1,
  addMember: async () => 1,
  removeMember: async () => true,
  isMember: async () => false,
  findMembers: async () => [],
  findChannelConversation: async () => null as ConversationRow | null,
  findTeamConversation: async () => null as ConversationRow | null,
  canAccessTeamConversation: async () => true,
};

const messageRepository = {};
const userRepository = {};

const teamService = new TeamService(
  teamRepository as unknown as TeamRepository,
  teamMemberRepository as unknown as TeamMemberRepository,
  conversationRepository as unknown as ConversationRepository,
);

const channelService = new ChannelService(
  channelRepository as unknown as ChannelRepository,
  channelMemberRepository as unknown as ChannelMemberRepository,
  teamMemberRepository as unknown as TeamMemberRepository,
  conversationRepository as unknown as ConversationRepository,
);

const conversationService = new ConversationService(
  conversationRepository as unknown as ConversationRepository,
  messageRepository as unknown as MessageRepository,
  userRepository as unknown as UserRepository,
  channelRepository as unknown as ChannelRepository,
  channelMemberRepository as unknown as ChannelMemberRepository,
  teamRepository as unknown as TeamRepository,
  teamMemberRepository as unknown as TeamMemberRepository,
);

const makeTeam = (overrides: Partial<TeamRow> = {}): TeamRow => ({
  id: 1,
  company_id: 1,
  name: 'Engineering',
  description: null,
  created_by: 10,
  department_id: null,
  created_at: '2026-08-12T10:00:00Z',
  updated_at: '2026-08-12T10:00:00Z',
  ...overrides,
});

const makeChannel = (overrides: Partial<ChannelRow> = {}): ChannelRow => ({
  id: 1,
  company_id: 1,
  team_id: null,
  name: 'general',
  description: null,
  type: 'public',
  created_by: 10,
  is_archived: 0,
  created_at: '2026-08-12T10:00:00Z',
  updated_at: '2026-08-12T10:00:00Z',
  ...overrides,
});

const makeConversation = (overrides: Partial<ConversationRow> = {}): ConversationRow => ({
  id: 1,
  type: 'channel',
  created_by: 10,
  name: 'general',
  description: null,
  is_active: 1,
  created_at: '2026-08-12T10:00:00Z',
  updated_at: '2026-08-12T10:00:00Z',
  ...overrides,
});

const user = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: 5,
  email: 'dara@kneachat.com',
  role: 'manager',
  companyId: 1,
  ...overrides,
});

describe('TeamService.assertCanManageTeam (scoped management)', () => {
  it('lets admins manage any team in the company', async (t) => {
    const getRole = t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    await teamService.assertCanManageTeam(makeTeam(), user({ role: 'admin' }));
    assert.equal(getRole.mock.calls.length, 0);
  });

  it('lets super admins manage any team in the company', async (t) => {
    const getRole = t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    await teamService.assertCanManageTeam(makeTeam(), user({ role: 'super_admin' }));
    assert.equal(getRole.mock.calls.length, 0);
  });

  it('lets the team creator manage their own team', async (t) => {
    const getRole = t.mock.method(teamMemberRepository, 'getRole', async () => null);
    await teamService.assertCanManageTeam(makeTeam({ created_by: 5 }), user({ role: 'employee' }));
    assert.equal(getRole.mock.calls.length, 0);
  });

  it('rejects an employee team leader (management is manager+)', async (t) => {
    t.mock.method(teamMemberRepository, 'getRole', async () => 'leader');
    await assert.rejects(
      teamService.assertCanManageTeam(makeTeam(), user({ role: 'employee' })),
      /do not have permission/,
    );
  });

  it('lets a manager manage a team they are assigned to', async (t) => {
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    await teamService.assertCanManageTeam(makeTeam(), user({ role: 'manager' }));
  });

  it('rejects a manager who is not assigned to the team', async (t) => {
    t.mock.method(teamMemberRepository, 'getRole', async () => null);
    await assert.rejects(
      teamService.assertCanManageTeam(makeTeam(), user({ role: 'manager' })),
      /do not have permission/,
    );
  });

  it('rejects a plain employee member', async (t) => {
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    await assert.rejects(
      teamService.assertCanManageTeam(makeTeam(), user({ role: 'employee' })),
      /do not have permission/,
    );
  });
});

describe('TeamService.assertCanManageMembers (manager+ only)', () => {
  it('lets an assigned manager manage members', async (t) => {
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    await teamService.assertCanManageMembers(makeTeam(), user({ role: 'manager' }));
  });

  it('rejects an unassigned manager', async (t) => {
    t.mock.method(teamMemberRepository, 'getRole', async () => null);
    await assert.rejects(
      teamService.assertCanManageMembers(makeTeam(), user({ role: 'manager' })),
      /do not have permission/,
    );
  });

  it('lets admins manage members in any team', async (t) => {
    const getRole = t.mock.method(teamMemberRepository, 'getRole', async () => null);
    await teamService.assertCanManageMembers(makeTeam(), user({ role: 'admin' }));
    assert.equal(getRole.mock.calls.length, 0);
  });

  it('lets the team creator (employee) manage their own team\'s members', async (t) => {
    const getRole = t.mock.method(teamMemberRepository, 'getRole', async () => null);
    await teamService.assertCanManageMembers(makeTeam({ created_by: 5 }), user({ role: 'employee' }));
    assert.equal(getRole.mock.calls.length, 0);
  });

  it('rejects an employee team leader who is not the creator', async (t) => {
    t.mock.method(teamMemberRepository, 'getRole', async () => 'leader');
    await assert.rejects(
      teamService.assertCanManageMembers(makeTeam(), user({ role: 'employee' })),
      /do not have permission/,
    );
  });

  it('rejects a plain employee member', async (t) => {
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    await assert.rejects(
      teamService.assertCanManageMembers(makeTeam(), user({ role: 'employee' })),
      /do not have permission/,
    );
  });
});

describe('TeamService.deleteTeam (scoped)', () => {
  it('deletes when the manager is assigned to the team', async (t) => {
    t.mock.method(teamRepository, 'findById', async () => makeTeam());
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    const del = t.mock.method(teamRepository, 'delete', async () => true);

    const result = await teamService.deleteTeam(1, user({ role: 'manager' }));

    assert.equal(del.mock.calls.length, 1);
    assert.equal(result.message, 'Team deleted successfully');
  });

  it('rejects an unassigned manager', async (t) => {
    t.mock.method(teamRepository, 'findById', async () => makeTeam());
    t.mock.method(teamMemberRepository, 'getRole', async () => null);
    await assert.rejects(
      teamService.deleteTeam(1, user({ role: 'manager' })),
      /do not have permission/,
    );
  });
});

describe('ChannelService.assertCanManageChannel (scoped management)', () => {
  it('lets admins manage any channel in the company', async (t) => {
    const getRole = t.mock.method(channelMemberRepository, 'getRole', async () => null);
    await channelService.assertCanManageChannel(makeChannel(), user({ role: 'admin' }));
    assert.equal(getRole.mock.calls.length, 0);
  });

  it('lets the channel creator manage their own channel', async (t) => {
    const getRole = t.mock.method(channelMemberRepository, 'getRole', async () => null);
    await channelService.assertCanManageChannel(makeChannel({ created_by: 5 }), user({ role: 'employee' }));
    assert.equal(getRole.mock.calls.length, 0);
  });

  it('lets a channel admin manage their channel', async (t) => {
    t.mock.method(channelMemberRepository, 'getRole', async () => 'admin');
    await channelService.assertCanManageChannel(makeChannel(), user({ role: 'employee' }));
  });

  it('lets a manager manage a channel inside an assigned team', async (t) => {
    t.mock.method(channelMemberRepository, 'getRole', async () => 'member');
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    await channelService.assertCanManageChannel(makeChannel({ team_id: 2 }), user({ role: 'manager' }));
  });

  it('rejects a manager for a channel inside a team they are not assigned to', async (t) => {
    t.mock.method(channelMemberRepository, 'getRole', async () => 'member');
    t.mock.method(teamMemberRepository, 'getRole', async () => null);
    await assert.rejects(
      channelService.assertCanManageChannel(makeChannel({ team_id: 2 }), user({ role: 'manager' })),
      /do not have permission/,
    );
  });

  it('rejects a manager for a standalone channel (no team)', async (t) => {
    t.mock.method(channelMemberRepository, 'getRole', async () => 'member');
    await assert.rejects(
      channelService.assertCanManageChannel(makeChannel(), user({ role: 'manager' })),
      /do not have permission/,
    );
  });
});

describe('ChannelService.createChannel (scoped to assigned teams)', () => {
  const createData = {
    company_id: 1,
    name: 'releases',
    created_by: 5,
    type: 'public',
    team_id: 2,
  };

  it('lets an assigned manager create a channel inside their team', async (t) => {
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    const create = t.mock.method(channelRepository, 'create', async () => 1);
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ id: 1, team_id: 2 }));

    const channel = await channelService.createChannel(createData, user({ role: 'manager' }));

    assert.equal(create.mock.calls.length, 1);
    assert.equal(channel.id, 1);
  });

  it('rejects a manager creating a channel in an unassigned team', async (t) => {
    t.mock.method(teamMemberRepository, 'getRole', async () => null);
    const create = t.mock.method(channelRepository, 'create', async () => 1);

    await assert.rejects(
      channelService.createChannel(createData, user({ role: 'manager' })),
      /do not have permission to create a channel/,
    );
    assert.equal(create.mock.calls.length, 0);
  });

  it('lets an admin create a channel in any team', async (t) => {
    const getRole = t.mock.method(teamMemberRepository, 'getRole', async () => null);
    t.mock.method(channelRepository, 'create', async () => 1);
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ id: 1, team_id: 2 }));

    const channel = await channelService.createChannel(createData, user({ role: 'admin' }));

    assert.equal(getRole.mock.calls.length, 0);
    assert.equal(channel.id, 1);
  });

  it('lets an employee create a channel inside a team they belong to', async (t) => {
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    const create = t.mock.method(channelRepository, 'create', async () => 1);
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ id: 1, team_id: 2 }));

    const channel = await channelService.createChannel(createData, user({ role: 'employee' }));

    assert.equal(create.mock.calls.length, 1);
    assert.equal(channel.id, 1);
  });

  it('rejects an employee creating a channel in a team they are not in', async (t) => {
    t.mock.method(teamMemberRepository, 'getRole', async () => null);
    const create = t.mock.method(channelRepository, 'create', async () => 1);

    await assert.rejects(
      channelService.createChannel(createData, user({ role: 'employee' })),
      /do not have permission to create a channel/,
    );
    assert.equal(create.mock.calls.length, 0);
  });

  it('rejects an employee creating a standalone channel', async (t) => {
    const getRole = t.mock.method(teamMemberRepository, 'getRole', async () => null);
    const create = t.mock.method(channelRepository, 'create', async () => 1);

    await assert.rejects(
      channelService.createChannel({ ...createData, team_id: null }, user({ role: 'employee' })),
      /Only managers can create standalone channels/,
    );
    assert.equal(getRole.mock.calls.length, 0);
    assert.equal(create.mock.calls.length, 0);
  });

  it('lets a manager create a standalone channel', async (t) => {
    const getRole = t.mock.method(teamMemberRepository, 'getRole', async () => null);
    t.mock.method(channelRepository, 'create', async () => 1);
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ id: 1, team_id: null }));

    const channel = await channelService.createChannel({ ...createData, team_id: null }, user({ role: 'manager' }));

    assert.equal(getRole.mock.calls.length, 0);
    assert.equal(channel.id, 1);
  });
});

describe('ChannelService.deleteChannel (scoped)', () => {
  it('deletes when the manager is assigned to the channel team', async (t) => {
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ team_id: 2 }));
    t.mock.method(channelMemberRepository, 'getRole', async () => 'member');
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    const del = t.mock.method(channelRepository, 'delete', async () => true);

    const result = await channelService.deleteChannel(1, user({ role: 'manager' }));

    assert.equal(del.mock.calls.length, 1);
    assert.equal(result.message, 'Channel deleted successfully');
  });

  it('rejects an unassigned manager', async (t) => {
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ team_id: 2 }));
    t.mock.method(channelMemberRepository, 'getRole', async () => 'member');
    t.mock.method(teamMemberRepository, 'getRole', async () => null);
    await assert.rejects(
      channelService.deleteChannel(1, user({ role: 'manager' })),
      /do not have permission/,
    );
  });
});

describe('TeamService.updateTeam (scoped)', () => {
  it('lets an assigned manager update the team', async (t) => {
    t.mock.method(teamRepository, 'findById', async () => makeTeam());
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    const update = t.mock.method(teamRepository, 'update', async () => true);

    const result = await teamService.updateTeam(1, { name: 'Renamed' }, user({ role: 'manager' }));

    assert.equal(update.mock.calls.length, 1);
    assert.deepEqual(update.mock.calls[0].arguments, [1, { name: 'Renamed' }]);
    assert.equal(result.id, 1);
  });

  it('rejects an unassigned manager without touching the DB', async (t) => {
    t.mock.method(teamRepository, 'findById', async () => makeTeam());
    t.mock.method(teamMemberRepository, 'getRole', async () => null);
    const update = t.mock.method(teamRepository, 'update', async () => true);

    await assert.rejects(
      teamService.updateTeam(1, { name: 'Renamed' }, user({ role: 'manager' })),
      /do not have permission/,
    );
    assert.equal(update.mock.calls.length, 0);
  });
});

describe('TeamService.addMember / removeMember (scoped)', () => {
  it('lets an assigned manager add a member', async (t) => {
    t.mock.method(teamRepository, 'findById', async () => makeTeam());
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    const add = t.mock.method(teamMemberRepository, 'add', async () => 1);

    const result = await teamService.addMember(1, 2, 'member', user({ role: 'manager' }));

    assert.equal(add.mock.calls.length, 1);
    assert.deepEqual(add.mock.calls[0].arguments, [1, 2, 'member']);
    assert.equal(result.message, 'Member added successfully');
  });

  it('rejects an unassigned manager adding a member', async (t) => {
    t.mock.method(teamRepository, 'findById', async () => makeTeam());
    t.mock.method(teamMemberRepository, 'getRole', async () => null);
    const add = t.mock.method(teamMemberRepository, 'add', async () => 1);

    await assert.rejects(
      teamService.addMember(1, 2, 'member', user({ role: 'manager' })),
      /do not have permission/,
    );
    assert.equal(add.mock.calls.length, 0);
  });

  it('lets the employee team creator add a member', async (t) => {
    t.mock.method(teamRepository, 'findById', async () => makeTeam({ created_by: 5 }));
    const add = t.mock.method(teamMemberRepository, 'add', async () => 1);

    const result = await teamService.addMember(1, 2, 'member', user({ role: 'employee' }));

    assert.equal(add.mock.calls.length, 1);
    assert.equal(result.message, 'Member added successfully');
  });

  it('lets an assigned manager remove a member', async (t) => {
    t.mock.method(teamRepository, 'findById', async () => makeTeam());
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    const remove = t.mock.method(teamMemberRepository, 'remove', async () => true);

    const result = await teamService.removeMember(1, 2, user({ role: 'manager' }));

    assert.equal(remove.mock.calls.length, 1);
    assert.deepEqual(remove.mock.calls[0].arguments, [1, 2]);
    assert.equal(result.message, 'Member removed successfully');
  });

  it('rejects an unassigned manager removing a member', async (t) => {
    t.mock.method(teamRepository, 'findById', async () => makeTeam());
    t.mock.method(teamMemberRepository, 'getRole', async () => null);
    const remove = t.mock.method(teamMemberRepository, 'remove', async () => true);

    await assert.rejects(
      teamService.removeMember(1, 2, user({ role: 'manager' })),
      /do not have permission/,
    );
    assert.equal(remove.mock.calls.length, 0);
  });
});

describe('ChannelService.updateChannel (scoped)', () => {
  it('lets an assigned manager update a team channel', async (t) => {
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ team_id: 2 }));
    t.mock.method(channelMemberRepository, 'getRole', async () => 'member');
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    const update = t.mock.method(channelRepository, 'update', async () => true);

    const result = await channelService.updateChannel(1, { name: 'renamed' }, user({ role: 'manager' }));

    assert.equal(update.mock.calls.length, 1);
    assert.deepEqual(update.mock.calls[0].arguments, [1, { name: 'renamed' }]);
    assert.equal(result.id, 1);
  });

  it('rejects an unassigned manager without touching the DB', async (t) => {
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ team_id: 2 }));
    t.mock.method(channelMemberRepository, 'getRole', async () => 'member');
    t.mock.method(teamMemberRepository, 'getRole', async () => null);
    const update = t.mock.method(channelRepository, 'update', async () => true);

    await assert.rejects(
      channelService.updateChannel(1, { name: 'renamed' }, user({ role: 'manager' })),
      /do not have permission/,
    );
    assert.equal(update.mock.calls.length, 0);
  });
});

describe('ChannelService.addMember / removeMember (scoped)', () => {
  it('lets an assigned manager add a member to a team channel', async (t) => {
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ team_id: 2 }));
    t.mock.method(channelMemberRepository, 'getRole', async () => 'member');
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    const add = t.mock.method(channelMemberRepository, 'add', async () => 1);

    const result = await channelService.addMember(1, 2, 'member', user({ role: 'manager' }));

    assert.equal(add.mock.calls.length, 1);
    assert.deepEqual(add.mock.calls[0].arguments, [1, 2, 'member']);
    assert.equal(result.message, 'Member added successfully');
  });

  it('rejects an unassigned manager adding a member', async (t) => {
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ team_id: 2 }));
    t.mock.method(channelMemberRepository, 'getRole', async () => 'member');
    t.mock.method(teamMemberRepository, 'getRole', async () => null);
    const add = t.mock.method(channelMemberRepository, 'add', async () => 1);

    await assert.rejects(
      channelService.addMember(1, 2, 'member', user({ role: 'manager' })),
      /do not have permission/,
    );
    assert.equal(add.mock.calls.length, 0);
  });

  it('lets an assigned manager remove a member from a team channel', async (t) => {
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ team_id: 2 }));
    t.mock.method(channelMemberRepository, 'getRole', async () => 'member');
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    const remove = t.mock.method(channelMemberRepository, 'remove', async () => true);

    const result = await channelService.removeMember(1, 2, user({ role: 'manager' }));

    assert.equal(remove.mock.calls.length, 1);
    assert.deepEqual(remove.mock.calls[0].arguments, [1, 2]);
    assert.equal(result.message, 'Member removed successfully');
  });

  it('rejects an unassigned manager removing a member', async (t) => {
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ team_id: 2 }));
    t.mock.method(channelMemberRepository, 'getRole', async () => 'member');
    t.mock.method(teamMemberRepository, 'getRole', async () => null);
    const remove = t.mock.method(channelMemberRepository, 'remove', async () => true);

    await assert.rejects(
      channelService.removeMember(1, 2, user({ role: 'manager' })),
      /do not have permission/,
    );
    assert.equal(remove.mock.calls.length, 0);
  });
});

describe('TeamService.createTeam (add members at creation)', () => {
  it('adds selected members as regular members, creator as leader', async (t) => {
    t.mock.method(teamRepository, 'create', async () => 7);
    t.mock.method(teamRepository, 'findById', async () => makeTeam({ id: 7 }));
    const add = t.mock.method(teamMemberRepository, 'add', async () => 1);

    const team = await teamService.createTeam({
      company_id: 1,
      name: 'Squad',
      created_by: 5,
      member_ids: [11, 12],
    });

    assert.equal(team.id, 7);
    assert.deepEqual(add.mock.calls.map((c) => c.arguments), [
      [7, 5, 'leader'],
      [7, 11, 'member'],
      [7, 12, 'member'],
    ]);
  });

  it('skips the creator id, duplicates and invalid ids', async (t) => {
    t.mock.method(teamRepository, 'create', async () => 7);
    t.mock.method(teamRepository, 'findById', async () => makeTeam({ id: 7 }));
    // Stateful membership: 12 is already in the team, and anything the add
    // mock inserts becomes a member — mirroring real isMember behaviour.
    const added = new Set<number>([12]);
    const add = t.mock.method(teamMemberRepository, 'add', async (_teamId: number, userId: number) => {
      added.add(userId);
      return 1;
    });
    t.mock.method(teamMemberRepository, 'isMember', async (_teamId: number, userId: number) => added.has(userId));

    await teamService.createTeam({
      company_id: 1,
      name: 'Squad',
      created_by: 5,
      member_ids: [5, 11, 12, 'nope' as unknown as number, 11],
    });

    assert.deepEqual(add.mock.calls.map((c) => c.arguments), [
      [7, 5, 'leader'],
      [7, 11, 'member'],
    ]);
  });

  it('creates with just the creator when no members are selected', async (t) => {
    t.mock.method(teamRepository, 'create', async () => 7);
    t.mock.method(teamRepository, 'findById', async () => makeTeam({ id: 7 }));
    const add = t.mock.method(teamMemberRepository, 'add', async () => 1);

    await teamService.createTeam({ company_id: 1, name: 'Squad', created_by: 5 });

    assert.deepEqual(add.mock.calls.map((c) => c.arguments), [[7, 5, 'leader']]);
  });
});

describe('ChannelService.createChannel (add members at creation)', () => {
  it('lets an admin create with members (creator becomes admin)', async (t) => {
    t.mock.method(channelRepository, 'create', async () => 9);
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ id: 9 }));
    const add = t.mock.method(channelMemberRepository, 'add', async () => 1);

    const channel = await channelService.createChannel(
      { company_id: 1, name: 'releases', created_by: 5, member_ids: [11, 12] },
      user({ role: 'admin' }),
    );

    assert.equal(channel.id, 9);
    assert.deepEqual(add.mock.calls.map((c) => c.arguments), [
      [9, 5, 'admin'],
      [9, 11, 'member'],
      [9, 12, 'member'],
    ]);
  });

  it('lets an employee create a channel in their team with members', async (t) => {
    t.mock.method(channelRepository, 'create', async () => 9);
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ id: 9, team_id: 2 }));
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    const add = t.mock.method(channelMemberRepository, 'add', async () => 1);

    const channel = await channelService.createChannel(
      { company_id: 1, name: 'standup', created_by: 5, team_id: 2, member_ids: [11] },
      user({ role: 'employee' }),
    );

    assert.equal(channel.id, 9);
    assert.deepEqual(add.mock.calls.map((c) => c.arguments), [
      [9, 5, 'admin'],
      [9, 11, 'member'],
    ]);
  });

  it('skips creator and already-member ids on channels', async (t) => {
    t.mock.method(channelRepository, 'create', async () => 9);
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ id: 9 }));
    const added = new Set<number>([12]);
    const add = t.mock.method(channelMemberRepository, 'add', async (_channelId: number, userId: number) => {
      added.add(userId);
      return 1;
    });
    t.mock.method(channelMemberRepository, 'isMember', async (_channelId: number, userId: number) => added.has(userId));

    await channelService.createChannel(
      { company_id: 1, name: 'releases', created_by: 5, member_ids: [5, 11, 12] },
      user({ role: 'admin' }),
    );

    assert.deepEqual(add.mock.calls.map((c) => c.arguments), [
      [9, 5, 'admin'],
      [9, 11, 'member'],
    ]);
  });
});

describe('ChannelService member ops sync conversation membership (write access)', () => {
  it('grants conversation membership when a member is added', async (t) => {
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ id: 3, name: 'releases' }));
    t.mock.method(channelMemberRepository, 'getRole', async () => 'admin');
    t.mock.method(channelMemberRepository, 'isMember', async () => false);
    t.mock.method(channelMemberRepository, 'add', async () => 1);
    t.mock.method(conversationRepository, 'findChannelConversation', async () => makeConversation({ id: 8, name: 'releases' }));
    t.mock.method(conversationRepository, 'isMember', async () => false);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);

    const result = await channelService.addMember(3, 11, 'member', user({ role: 'admin' }));

    assert.equal(result.message, 'Member added successfully');
    assert.deepEqual(convAdd.mock.calls.map((c) => c.arguments), [[8, 11, 'member']]);
  });

  it('does not duplicate conversation membership when already a member', async (t) => {
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ id: 3, name: 'releases' }));
    t.mock.method(channelMemberRepository, 'getRole', async () => 'admin');
    t.mock.method(channelMemberRepository, 'isMember', async () => false);
    t.mock.method(channelMemberRepository, 'add', async () => 1);
    t.mock.method(conversationRepository, 'findChannelConversation', async () => makeConversation({ id: 8 }));
    t.mock.method(conversationRepository, 'isMember', async () => true);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);

    await channelService.addMember(3, 11, 'member', user({ role: 'admin' }));

    assert.equal(convAdd.mock.calls.length, 0);
  });

  it('skips the sync when the channel has no conversation yet', async (t) => {
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ id: 3, name: 'releases' }));
    t.mock.method(channelMemberRepository, 'getRole', async () => 'admin');
    t.mock.method(channelMemberRepository, 'isMember', async () => false);
    t.mock.method(channelMemberRepository, 'add', async () => 1);
    t.mock.method(conversationRepository, 'findChannelConversation', async () => null);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);

    await channelService.addMember(3, 11, 'member', user({ role: 'admin' }));

    assert.equal(convAdd.mock.calls.length, 0);
  });

  it('revokes conversation membership when a member is removed', async (t) => {
    t.mock.method(channelRepository, 'findById', async () => makeChannel({ id: 3, name: 'releases' }));
    t.mock.method(channelMemberRepository, 'getRole', async () => 'admin');
    t.mock.method(channelMemberRepository, 'remove', async () => true);
    t.mock.method(conversationRepository, 'findChannelConversation', async () => makeConversation({ id: 8 }));
    const convRemove = t.mock.method(conversationRepository, 'removeMember', async () => true);

    const result = await channelService.removeMember(3, 11, user({ role: 'admin' }));

    assert.equal(result.message, 'Member removed successfully');
    assert.deepEqual(convRemove.mock.calls.map((c) => c.arguments), [[8, 11]]);
  });
});

describe('ConversationService.createConversation auto-joins channel members', () => {
  it('adds every current channel member when the channel conversation is created', async (t) => {
    t.mock.method(conversationRepository, 'create', async () => 8);
    t.mock.method(conversationRepository, 'findById', async () => makeConversation({ id: 8 }));
    t.mock.method(conversationRepository, 'findMembers', async () => []);
    t.mock.method(conversationRepository, 'isMember', async () => false);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);
    t.mock.method(channelRepository, 'findByName', async () => [makeChannel({ id: 3, name: 'releases' })]);
    t.mock.method(channelMemberRepository, 'findMemberIds', async () => [11, 12]);

    await conversationService.createConversation({
      type: 'channel',
      created_by: 5,
      name: 'releases',
      company_id: 1,
    });

    // Creator (admin) + every existing channel member.
    assert.deepEqual(convAdd.mock.calls.map((c) => c.arguments), [
      [8, 5, 'admin'],
      [8, 11, 'member'],
      [8, 12, 'member'],
    ]);
  });

  it('does not touch channels for group conversations', async (t) => {
    t.mock.method(conversationRepository, 'create', async () => 8);
    t.mock.method(conversationRepository, 'findById', async () => makeConversation({ id: 8, type: 'group' }));
    t.mock.method(conversationRepository, 'findMembers', async () => []);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);
    const findByName = t.mock.method(channelRepository, 'findByName', async () => []);

    await conversationService.createConversation({
      type: 'group',
      created_by: 5,
      name: 'Squad',
      company_id: 1,
    });

    assert.equal(findByName.mock.calls.length, 0);
    assert.deepEqual(convAdd.mock.calls.map((c) => c.arguments), [[8, 5, 'admin']]);
  });
});

describe('ConversationService.createConversation auto-joins team members', () => {
  it('adds every current team member when the team conversation is created', async (t) => {
    t.mock.method(conversationRepository, 'create', async () => 9);
    t.mock.method(conversationRepository, 'findById', async () => makeConversation({ id: 9, type: 'team', name: 'Engineering' }));
    t.mock.method(conversationRepository, 'findMembers', async () => []);
    t.mock.method(conversationRepository, 'isMember', async () => false);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);
    t.mock.method(teamRepository, 'findByName', async () => [makeTeam({ id: 3, name: 'Engineering' })]);
    t.mock.method(teamMemberRepository, 'findMemberIds', async () => [11, 12]);

    await conversationService.createConversation({
      type: 'team',
      created_by: 5,
      name: 'Engineering',
      company_id: 1,
    });

    // Creator (admin) + every existing team member.
    assert.deepEqual(convAdd.mock.calls.map((c) => c.arguments), [
      [9, 5, 'admin'],
      [9, 11, 'member'],
      [9, 12, 'member'],
    ]);
  });

  it('does not touch teams for group conversations', async (t) => {
    t.mock.method(conversationRepository, 'create', async () => 9);
    t.mock.method(conversationRepository, 'findById', async () => makeConversation({ id: 9, type: 'group' }));
    t.mock.method(conversationRepository, 'findMembers', async () => []);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);
    const findByName = t.mock.method(teamRepository, 'findByName', async () => []);

    await conversationService.createConversation({
      type: 'group',
      created_by: 5,
      name: 'Squad',
      company_id: 1,
    });

    assert.equal(findByName.mock.calls.length, 0);
    assert.deepEqual(convAdd.mock.calls.map((c) => c.arguments), [[9, 5, 'admin']]);
  });

  it('reuses an existing team conversation instead of duplicating it', async (t) => {
    t.mock.method(conversationRepository, 'findTeamConversation', async () => makeConversation({ id: 9, type: 'team', name: 'Engineering' }));
    t.mock.method(conversationRepository, 'findMembers', async () => []);
    const create = t.mock.method(conversationRepository, 'create', async () => 99);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);
    t.mock.method(teamRepository, 'findByName', async () => [makeTeam({ id: 3, name: 'Engineering' })]);
    t.mock.method(teamMemberRepository, 'findMemberIds', async () => [11, 12]);

    const conv = await conversationService.createConversation({
      type: 'team',
      created_by: 5,
      name: 'Engineering',
      company_id: 1,
    });

    assert.equal(create.mock.calls.length, 0);
    assert.equal(conv.id, 9);
    // Creator joins as a regular member + the existing team members.
    assert.deepEqual(convAdd.mock.calls.map((c) => c.arguments), [
      [9, 5, 'member'],
      [9, 11, 'member'],
      [9, 12, 'member'],
    ]);
  });

  it('does not re-add an existing member when re-opening a team conversation', async (t) => {
    t.mock.method(conversationRepository, 'findTeamConversation', async () => makeConversation({ id: 9, type: 'team', name: 'Engineering' }));
    t.mock.method(conversationRepository, 'findMembers', async () => []);
    const create = t.mock.method(conversationRepository, 'create', async () => 99);
    // The creator is already a member (they opened it before) — addMember is a
    // raw INSERT and must not be called again for them.
    t.mock.method(conversationRepository, 'isMember', async (_convId: number, userId: number) => userId === 5);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);
    t.mock.method(teamRepository, 'findByName', async () => [makeTeam({ id: 3, name: 'Engineering' })]);
    t.mock.method(teamMemberRepository, 'findMemberIds', async () => [11, 12]);

    const conv = await conversationService.createConversation({
      type: 'team',
      created_by: 5,
      name: 'Engineering',
      company_id: 1,
    });

    assert.equal(create.mock.calls.length, 0);
    assert.equal(conv.id, 9);
    // Only the not-yet-joined team members get added.
    assert.deepEqual(convAdd.mock.calls.map((c) => c.arguments), [
      [9, 11, 'member'],
      [9, 12, 'member'],
    ]);
  });
});

describe('TeamService member ops sync conversation membership (write access)', () => {
  it('grants conversation membership when a member is added', async (t) => {
    t.mock.method(teamRepository, 'findById', async () => makeTeam({ id: 3, name: 'Engineering' }));
    t.mock.method(teamMemberRepository, 'getRole', async () => 'member');
    t.mock.method(teamMemberRepository, 'isMember', async () => false);
    t.mock.method(teamMemberRepository, 'add', async () => 1);
    t.mock.method(conversationRepository, 'findTeamConversation', async () => makeConversation({ id: 8, type: 'team', name: 'Engineering' }));
    t.mock.method(conversationRepository, 'isMember', async () => false);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);

    const result = await teamService.addMember(3, 11, 'member', user({ role: 'admin' }));

    assert.equal(result.message, 'Member added successfully');
    assert.deepEqual(convAdd.mock.calls.map((c) => c.arguments), [[8, 11, 'member']]);
  });

  it('does not duplicate conversation membership when already a member', async (t) => {
    t.mock.method(teamRepository, 'findById', async () => makeTeam({ id: 3, name: 'Engineering' }));
    t.mock.method(teamMemberRepository, 'getRole', async () => 'admin');
    t.mock.method(teamMemberRepository, 'isMember', async () => false);
    t.mock.method(teamMemberRepository, 'add', async () => 1);
    t.mock.method(conversationRepository, 'findTeamConversation', async () => makeConversation({ id: 8, type: 'team' }));
    t.mock.method(conversationRepository, 'isMember', async () => true);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);

    await teamService.addMember(3, 11, 'member', user({ role: 'admin' }));

    assert.equal(convAdd.mock.calls.length, 0);
  });

  it('skips the sync when the team has no conversation yet', async (t) => {
    t.mock.method(teamRepository, 'findById', async () => makeTeam({ id: 3, name: 'Engineering' }));
    t.mock.method(teamMemberRepository, 'getRole', async () => 'admin');
    t.mock.method(teamMemberRepository, 'isMember', async () => false);
    t.mock.method(teamMemberRepository, 'add', async () => 1);
    t.mock.method(conversationRepository, 'findTeamConversation', async () => null);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);

    await teamService.addMember(3, 11, 'member', user({ role: 'admin' }));

    assert.equal(convAdd.mock.calls.length, 0);
  });

  it('revokes conversation membership when a member is removed', async (t) => {
    t.mock.method(teamRepository, 'findById', async () => makeTeam({ id: 3, name: 'Engineering' }));
    t.mock.method(teamMemberRepository, 'getRole', async () => 'admin');
    t.mock.method(teamMemberRepository, 'remove', async () => true);
    t.mock.method(conversationRepository, 'findTeamConversation', async () => makeConversation({ id: 8, type: 'team' }));
    const convRemove = t.mock.method(conversationRepository, 'removeMember', async () => true);

    const result = await teamService.removeMember(3, 11, user({ role: 'admin' }));

    assert.equal(result.message, 'Member removed successfully');
    assert.deepEqual(convRemove.mock.calls.map((c) => c.arguments), [[8, 11]]);
  });
});

describe('ConversationService team access (open/create is member-or-privileged only)', () => {
  it('rejects a non-member employee opening a team conversation before creating anything', async (t) => {
    t.mock.method(conversationRepository, 'canAccessTeamConversation', async () => false);
    const create = t.mock.method(conversationRepository, 'create', async () => 99);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);

    await assert.rejects(
      conversationService.createConversation({
        type: 'team',
        created_by: 5,
        name: 'Engineering',
        company_id: 1,
      }),
      /must be a member of this team/,
    );
    assert.equal(create.mock.calls.length, 0);
    assert.equal(convAdd.mock.calls.length, 0);
  });

  it('lets a manager (not in the team) open a team conversation', async (t) => {
    const canAccess = t.mock.method(conversationRepository, 'canAccessTeamConversation', async () => true);
    t.mock.method(conversationRepository, 'findTeamConversation', async () => null);
    t.mock.method(conversationRepository, 'create', async () => 9);
    t.mock.method(conversationRepository, 'findById', async () => makeConversation({ id: 9, type: 'team', name: 'Engineering' }));
    t.mock.method(conversationRepository, 'findMembers', async () => []);
    t.mock.method(teamRepository, 'findByName', async () => [makeTeam({ id: 3, name: 'Engineering' })]);
    t.mock.method(teamMemberRepository, 'findMemberIds', async () => []);

    const conv = await conversationService.createConversation({
      type: 'team',
      created_by: 5,
      name: 'Engineering',
      company_id: 1,
    });

    assert.equal(canAccess.mock.calls.length, 1);
    assert.equal(conv.id, 9);
  });

  it('rejects a team conversation without a name (no generic bypass)', async (t) => {
    const canAccess = t.mock.method(conversationRepository, 'canAccessTeamConversation', async () => true);
    const create = t.mock.method(conversationRepository, 'create', async () => 99);

    await assert.rejects(
      conversationService.createConversation({ type: 'team', created_by: 5, company_id: 1 }),
      /require a team name/,
    );
    assert.equal(canAccess.mock.calls.length, 0);
    assert.equal(create.mock.calls.length, 0);
  });

  it('getConversation: allows a user with team access even without conversation membership', async (t) => {
    t.mock.method(conversationRepository, 'findById', async () => makeConversation({ id: 9, type: 'team', name: 'Engineering' }));
    t.mock.method(conversationRepository, 'canAccessTeamConversation', async () => true);
    const isMember = t.mock.method(conversationRepository, 'isMember', async () => false);

    const conv = await conversationService.getConversation(9, 5);

    assert.equal(conv.id, 9);
    // The team rule replaces the plain membership check.
    assert.equal(isMember.mock.calls.length, 0);
  });

  it('getConversation: rejects a stale conversation member with no team access', async (t) => {
    t.mock.method(conversationRepository, 'findById', async () => makeConversation({ id: 9, type: 'team', name: 'Engineering' }));
    t.mock.method(conversationRepository, 'canAccessTeamConversation', async () => false);

    await assert.rejects(
      conversationService.getConversation(9, 5),
      /must be a member of this team/,
    );
  });

  it('getConversations: filters out team conversations the user cannot access', async (t) => {
    const teamConv = makeConversation({ id: 9, type: 'team', name: 'Engineering' });
    const channelConv = makeConversation({ id: 3, type: 'channel', name: 'general' });
    t.mock.method(conversationRepository, 'findAll', async () => [teamConv, channelConv]);
    t.mock.method(conversationRepository, 'canAccessTeamConversation', async () => false);
    t.mock.method(conversationRepository, 'findMembers', async () => []);

    const result = await conversationService.getConversations({ userId: 5 });

    assert.deepEqual(result.conversations.map((c) => c.id), [3]);
  });

  it('addMember: forbids adding another user to a team conversation', async (t) => {
    t.mock.method(conversationRepository, 'findById', async () => makeConversation({ id: 9, type: 'team', name: 'Engineering' }));
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);

    await assert.rejects(
      conversationService.addMember(9, 11, 5),
      /managed through the team/,
    );
    assert.equal(convAdd.mock.calls.length, 0);
  });

  it('addMember: rejects a non-member self-join into a team conversation', async (t) => {
    t.mock.method(conversationRepository, 'findById', async () => makeConversation({ id: 9, type: 'team', name: 'Engineering' }));
    t.mock.method(conversationRepository, 'canAccessTeamConversation', async () => false);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);

    await assert.rejects(
      conversationService.addMember(9, 5, 5),
      /must be a member of this team/,
    );
    assert.equal(convAdd.mock.calls.length, 0);
  });

  it('addMember: allows an authorized self-join into a team conversation', async (t) => {
    t.mock.method(conversationRepository, 'findById', async () => makeConversation({ id: 9, type: 'team', name: 'Engineering' }));
    t.mock.method(conversationRepository, 'canAccessTeamConversation', async () => true);
    t.mock.method(conversationRepository, 'isMember', async () => false);
    const convAdd = t.mock.method(conversationRepository, 'addMember', async () => 1);

    const result = await conversationService.addMember(9, 5, 5);

    assert.equal(result.message, 'Member added successfully');
    assert.deepEqual(convAdd.mock.calls[0].arguments, [9, 5, 'member']);
  });
});
