'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SharedFileService } from '../src/services/SharedFile.service';
import type { SharedFileRepository } from '../src/repositories/sharedFileRepository';

// ---------------------------------------------------------------------------
// In-memory stub of SharedFileRepository (constructor-injected, no DB needed)
// ---------------------------------------------------------------------------

interface FileRecord {
  id: number;
  company_id: number;
  team_id: number | null;
  uploaded_by: number;
  file_name: string;
  file_url: string;
  file_type: string | null;
  file_size: number | null;
  description: string | null;
  is_public: number;
}

interface UserRecord {
  id: number;
  role: string;
  company_id: number;
}

interface ShareRecord {
  id: number;
  file_id: number;
  target_type: 'team' | 'conversation';
  target_id: number;
  shared_by: number;
}

interface PermRecord {
  file_id: number;
  user_id: number;
  permission: string;
}

const makeRepo = (opts: {
  users?: UserRecord[];
  files?: FileRecord[];
  teams?: Array<{ id: number; company_id: number; name: string }>;
  teamMembers?: Array<{ team_id: number; user_id: number }>;
  conversations?: Array<{ id: number; type: string; name: string | null; is_active: number }>;
  conversationMembers?: Array<{ conversation_id: number; user_id: number }>;
  shares?: ShareRecord[];
  permissions?: PermRecord[];
} = {}) => {
  let nextFileId = 100;
  let nextShareId = 1000;
  const files: FileRecord[] = (opts.files || []).map((f) => ({ ...f }));
  const shares: ShareRecord[] = (opts.shares || []).map((s) => ({ ...s }));
  const permissions: PermRecord[] = (opts.permissions || []).map((p) => ({ ...p }));
  const users = opts.users || [];
  const teams = opts.teams || [];
  const teamMembers = opts.teamMembers || [];
  const conversations = opts.conversations || [];
  const conversationMembers = opts.conversationMembers || [];

  const findUser = (id: number) => users.find((u) => u.id === id) || null;

  const isPrivileged = (companyId: number, userId: number): boolean => {
    const u = findUser(userId);
    return !!u && u.company_id === companyId && ['super_admin', 'admin', 'manager'].includes(u.role);
  };

  return {
    // store access for assertions
    files,
    shares,
    permissions,

    findById: async (id: number) => {
      const f = files.find((x) => x.id === id);
      if (!f) return null;
      return { ...f, team_name: null, uploader_first_name: 'U', uploader_last_name: String(f.uploaded_by) };
    },
    isOwner: async (fileId: number, userId: number) => {
      const f = files.find((x) => x.id === fileId);
      return !!f && f.uploaded_by === userId;
    },
    findUserPermission: async (fileId: number, userId: number) => {
      const p = permissions.find((x) => x.file_id === fileId && x.user_id === userId);
      return p ? { ...p, id: 1, granted_at: new Date() } : null;
    },
    canAccess: async (fileId: number, userId: number) => {
      const f = files.find((x) => x.id === fileId);
      if (!f) return false;
      if (f.is_public === 1 || f.uploaded_by === userId) return true;
      if (permissions.some((p) => p.file_id === fileId && p.user_id === userId)) return true;
      const privileged = isPrivileged(f.company_id, userId);
      if (f.team_id && (privileged || teamMembers.some((m) => m.team_id === f.team_id && m.user_id === userId))) return true;
      for (const s of shares.filter((x) => x.file_id === fileId)) {
        if (privileged) return true;
        if (s.target_type === 'team' && teamMembers.some((m) => m.team_id === s.target_id && m.user_id === userId)) return true;
        if (s.target_type === 'conversation' && conversationMembers.some((m) => m.conversation_id === s.target_id && m.user_id === userId)) return true;
      }
      return false;
    },
    findUserRole: async (userId: number) => findUser(userId),
    isTeamMember: async (teamId: number, userId: number) =>
      teamMembers.some((m) => m.team_id === teamId && m.user_id === userId),
    isConversationMember: async (conversationId: number, userId: number) =>
      conversationMembers.some((m) => m.conversation_id === conversationId && m.user_id === userId),
    findTeam: async (teamId: number) => teams.find((t) => t.id === teamId) || null,
    findConversation: async (conversationId: number) =>
      conversations.find((c) => c.id === conversationId && c.is_active === 1) || null,
    create: async (data: Record<string, any>) => {
      const id = nextFileId++;
      files.push({
        id,
        company_id: data.company_id,
        team_id: data.team_id ?? null,
        uploaded_by: data.uploaded_by,
        file_name: data.file_name,
        file_url: data.file_url,
        file_type: data.file_type || null,
        file_size: data.file_size || null,
        description: data.description || null,
        is_public: data.is_public ? 1 : 0,
      });
      return id;
    },
    findTeamFiles: async (teamId: number, companyId: number) => {
      const list = files.filter(
        (f) =>
          f.company_id === companyId &&
          (f.team_id === teamId || shares.some((s) => s.file_id === f.id && s.target_type === 'team' && s.target_id === teamId)),
      );
      return { files: list.map((f) => ({ ...f })), total: list.length };
    },
    createShare: async (data: Record<string, any>) => {
      const existing = shares.find(
        (s) => s.file_id === data.file_id && s.target_type === data.target_type && s.target_id === data.target_id,
      );
      if (existing) {
        existing.shared_by = data.shared_by;
        return;
      }
      shares.push({ id: nextShareId++, file_id: data.file_id, target_type: data.target_type, target_id: data.target_id, shared_by: data.shared_by });
    },
    findShareByTarget: async (fileId: number, targetType: string, targetId: number) => {
      const s = shares.find((x) => x.file_id === fileId && x.target_type === targetType && x.target_id === targetId);
      return s ? { ...s } : null;
    },
    findShareById: async (id: number) => {
      const s = shares.find((x) => x.id === id);
      return s ? { ...s } : null;
    },
    removeShare: async (id: number) => {
      const i = shares.findIndex((x) => x.id === id);
      if (i < 0) return false;
      shares.splice(i, 1);
      return true;
    },
    findShares: async () => shares.slice(),
    // createSharedFile grants the uploader 'manage' on public uploads.
    createPermission: async (data: Record<string, any>) => {
      permissions.push({
        file_id: data.file_id,
        user_id: data.user_id,
        permission: data.permission,
      });
      return 1;
    },
  };
};

// ---------------------------------------------------------------------------
// Helpers — realistic fixtures
// ---------------------------------------------------------------------------

const COMPANY = 1;
const OTHER_COMPANY = 2;

const EMPLOYEE = (id: number, companyId = COMPANY): UserRecord => ({ id, role: 'employee', company_id: companyId });
const MANAGER = (id: number, companyId = COMPANY): UserRecord => ({ id, role: 'manager', company_id: companyId });

const BASE_FILE = (overrides: Partial<FileRecord>): FileRecord => ({
  id: 1,
  company_id: COMPANY,
  team_id: null,
  uploaded_by: 1,
  file_name: 'report.pdf',
  file_url: '/uploads/x.pdf',
  file_type: 'application/pdf',
  file_size: 1024,
  description: null,
  is_public: 0,
  ...overrides,
});

const makeService = (repo: ReturnType<typeof makeRepo>) =>
  new SharedFileService(repo as unknown as SharedFileRepository);

beforeEach(() => {});

// ---------------------------------------------------------------------------
// Team files — upload + listing access
// ---------------------------------------------------------------------------

describe('SharedFileService team files', () => {
  it('rejects uploading into a team when the user is not a member', async () => {
    const repo = makeRepo({
      users: [EMPLOYEE(1), EMPLOYEE(2)],
      teams: [{ id: 10, company_id: COMPANY, name: 'Engineering' }],
      teamMembers: [{ team_id: 10, user_id: 2 }],
    });
    const svc = makeService(repo);
    await assert.rejects(
      svc.createSharedFile({
        company_id: COMPANY,
        team_id: 10,
        uploaded_by: 1,
        file_name: 'a.pdf',
        file_url: '/uploads/a.pdf',
        is_public: true,
      }),
      /Only team members can upload files to a team/,
    );
  });

  it('stores team files as non-public so they never leak company-wide', async () => {
    const repo = makeRepo({
      users: [EMPLOYEE(1)],
      teams: [{ id: 10, company_id: COMPANY, name: 'Engineering' }],
      teamMembers: [{ team_id: 10, user_id: 1 }],
    });
    const svc = makeService(repo);
    const file = await svc.createSharedFile({
      company_id: COMPANY,
      team_id: 10,
      uploaded_by: 1,
      file_name: 'a.pdf',
      file_url: '/uploads/a.pdf',
      is_public: true, // caller's flag must be overridden for team uploads
    });
    assert.equal(file.team_id, 10);
    assert.equal(file.is_public, 0);
  });

  it('keeps a company-wide upload public when the caller says so', async () => {
    const repo = makeRepo({ users: [EMPLOYEE(1)] });
    const svc = makeService(repo);
    const file = await svc.createSharedFile({
      company_id: COMPANY,
      uploaded_by: 1,
      file_name: 'a.pdf',
      file_url: '/uploads/a.pdf',
      is_public: true,
    });
    assert.equal(file.team_id, null);
    assert.equal(file.is_public, 1);
  });

  it('lists team files for members and for managers of the team\'s company', async () => {
    const teamFile = BASE_FILE({ id: 5, team_id: 10, uploaded_by: 2, is_public: 0 });
    const repo = makeRepo({
      users: [EMPLOYEE(1), EMPLOYEE(2), MANAGER(9)],
      teams: [{ id: 10, company_id: COMPANY, name: 'Engineering' }],
      teamMembers: [{ team_id: 10, user_id: 1 }, { team_id: 10, user_id: 2 }],
      files: [teamFile],
      shares: [
        { id: 1, file_id: 5, target_type: 'team', target_id: 10, shared_by: 2 },
      ],
    });
    const svc = makeService(repo);

    const asMember = await svc.listTeamFiles(10, 1);
    assert.equal(asMember.total, 1);
    assert.equal(asMember.files[0].id, 5);

    const asManager = await svc.listTeamFiles(10, 9);
    assert.equal(asManager.total, 1);
  });

  it('rejects listing a team\'s files for an outsider employee', async () => {
    const repo = makeRepo({
      users: [EMPLOYEE(1), EMPLOYEE(3)],
      teams: [{ id: 10, company_id: COMPANY, name: 'Engineering' }],
      teamMembers: [{ team_id: 10, user_id: 1 }],
    });
    const svc = makeService(repo);
    await assert.rejects(svc.listTeamFiles(10, 3), /must be a member of this team/);
  });

  it('rejects a manager of another company from listing this company\'s team files', async () => {
    const repo = makeRepo({
      users: [EMPLOYEE(1), MANAGER(9, OTHER_COMPANY)],
      teams: [{ id: 10, company_id: COMPANY, name: 'Engineering' }],
      teamMembers: [{ team_id: 10, user_id: 1 }],
    });
    const svc = makeService(repo);
    await assert.rejects(svc.listTeamFiles(10, 9), /must be a member of this team/);
  });
});

// ---------------------------------------------------------------------------
// Sharing — destination-based access
// ---------------------------------------------------------------------------

describe('SharedFileService sharing', () => {
  it('lets the owner share with a team they belong to', async () => {
    const repo = makeRepo({
      users: [EMPLOYEE(1), EMPLOYEE(2)],
      teams: [{ id: 10, company_id: COMPANY, name: 'Engineering' }],
      teamMembers: [{ team_id: 10, user_id: 1 }, { team_id: 10, user_id: 2 }],
      files: [BASE_FILE({})],
    });
    const svc = makeService(repo);
    const share = await svc.shareFile(1, 1, 'team', 10);
    assert.equal(share.target_type, 'team');
    assert.equal(share.target_id, 10);
    assert.equal(share.shared_by, 1);
    assert.equal(repo.shares.length, 1);
  });

  it('rejects sharing with a team the sharer is not part of (employee)', async () => {
    const repo = makeRepo({
      users: [EMPLOYEE(1), EMPLOYEE(3)],
      teams: [{ id: 10, company_id: COMPANY, name: 'Engineering' }],
      teamMembers: [{ team_id: 10, user_id: 3 }],
      files: [BASE_FILE({})],
    });
    const svc = makeService(repo);
    await assert.rejects(svc.shareFile(1, 1, 'team', 10), /must be a member of the team/);
  });

  it('rejects sharing across companies', async () => {
    const repo = makeRepo({
      users: [MANAGER(9)],
      teams: [{ id: 20, company_id: OTHER_COMPANY, name: 'Other Co' }],
      files: [BASE_FILE({})],
    });
    const svc = makeService(repo);
    // Manager 9 owns nothing, so grant manage so the check reaches the
    // cross-company guard.
    repo.permissions.push({ file_id: 1, user_id: 9, permission: 'manage' });
    await assert.rejects(svc.shareFile(1, 9, 'team', 20), /same company/);
  });

  it('lets a conversation member share into that conversation; rejects strangers', async () => {
    const repo = makeRepo({
      users: [EMPLOYEE(1), EMPLOYEE(2)],
      conversations: [{ id: 30, type: 'direct', name: null, is_active: 1 }],
      conversationMembers: [
        { conversation_id: 30, user_id: 1 },
        { conversation_id: 30, user_id: 2 },
      ],
      files: [BASE_FILE({})],
    });
    const svc = makeService(repo);
    const share = await svc.shareFile(1, 1, 'conversation', 30);
    assert.equal(share.target_type, 'conversation');
    assert.equal(share.target_id, 30);

    const outsider = makeRepo({
      users: [EMPLOYEE(1), EMPLOYEE(5)],
      conversations: [{ id: 30, type: 'direct', name: null, is_active: 1 }],
      conversationMembers: [{ conversation_id: 30, user_id: 1 }],
      files: [BASE_FILE({})],
    });
    // User 5 owns nothing — grant manage so the membership check is reached.
    outsider.permissions.push({ file_id: 1, user_id: 5, permission: 'manage' });
    await assert.rejects(
      makeService(outsider).shareFile(1, 5, 'conversation', 30),
      /must be part of the conversation/,
    );
  });

  it('rejects an invalid target type and sharing by a non-owner without manage permission', async () => {
    const repo = makeRepo({
      users: [EMPLOYEE(1), EMPLOYEE(2)],
      teams: [{ id: 10, company_id: COMPANY, name: 'Engineering' }],
      teamMembers: [{ team_id: 10, user_id: 1 }, { team_id: 10, user_id: 2 }],
      files: [BASE_FILE({ uploaded_by: 2 })], // owned by user 2
    });
    const svc = makeService(repo);
    // A non-owner without a permission row is stopped before type validation.
    await assert.rejects(svc.shareFile(1, 1, 'team', 10), /do not have permission to share/);
    // The owner gets the invalid-target_type error.
    await assert.rejects(svc.shareFile(1, 2, 'company', 10), /target_type must be/);

    // A granted 'manage' permission lets a non-owner share.
    repo.permissions.push({ file_id: 1, user_id: 1, permission: 'manage' });
    const share = await svc.shareFile(1, 1, 'team', 10);
    assert.ok(share.id);
  });

  it('keeps sharing idempotent for the same destination', async () => {
    const repo = makeRepo({
      users: [EMPLOYEE(1), EMPLOYEE(2)],
      teams: [{ id: 10, company_id: COMPANY, name: 'Engineering' }],
      teamMembers: [{ team_id: 10, user_id: 1 }, { team_id: 10, user_id: 2 }],
      files: [BASE_FILE({})],
    });
    const svc = makeService(repo);
    await svc.shareFile(1, 1, 'team', 10);
    await svc.shareFile(1, 1, 'team', 10);
    assert.equal(repo.shares.length, 1);
  });

  it('owner and the original sharer can unshare; others cannot', async () => {
    const repo = makeRepo({
      users: [EMPLOYEE(1), EMPLOYEE(2), EMPLOYEE(3)],
      teams: [{ id: 10, company_id: COMPANY, name: 'Engineering' }],
      teamMembers: [{ team_id: 10, user_id: 1 }, { team_id: 10, user_id: 2 }, { team_id: 10, user_id: 3 }],
      files: [BASE_FILE({})], // owned by user 1
      shares: [{ id: 55, file_id: 1, target_type: 'team', target_id: 10, shared_by: 2 }],
    });
    const svc = makeService(repo);

    // Member 3 neither owns the file nor created the share.
    await assert.rejects(svc.unshareFile(55, 3), /do not have permission to unshare/);

    // The original sharer can remove their own share.
    await svc.unshareFile(55, 2);
    assert.equal(repo.shares.length, 0);

    // Owner can remove a share made by someone else too.
    repo.shares.push({ id: 56, file_id: 1, target_type: 'team', target_id: 10, shared_by: 2 });
    await svc.unshareFile(56, 1);
    assert.equal(repo.shares.length, 0);
  });

  it('exposes shares for accessible files only (getFileShares)', async () => {
    const repo = makeRepo({
      users: [EMPLOYEE(1), EMPLOYEE(2)],
      files: [BASE_FILE({ is_public: 1 })],
      shares: [{ id: 60, file_id: 1, target_type: 'team', target_id: 10, shared_by: 1 }],
    });
    const svc = makeService(repo);
    const shares = await svc.getFileShares(1, 2);
    assert.equal(shares.length, 1);
    assert.equal(shares[0].target_type, 'team');
  });
});

// ---------------------------------------------------------------------------
// Embedding — share a file into a conversation as a chat message
// ---------------------------------------------------------------------------

const makeEmbedContext = (opts: {
  users?: UserRecord[];
  files?: FileRecord[];
  conversations?: Array<{ id: number; type: string; name: string | null; is_active: number }>;
  conversationMembers?: Array<{ conversation_id: number; user_id: number }>;
} = {}) => {
  const conversations = opts.conversations || [{ id: 30, type: 'direct', name: null, is_active: 1 }];
  const members =
    opts.conversationMembers || [
      { conversation_id: 30, user_id: 1 },
      { conversation_id: 30, user_id: 2 },
    ];
  const repo = makeRepo({
    users: opts.users || [EMPLOYEE(1), EMPLOYEE(2)],
    files: opts.files || [BASE_FILE({})],
    conversations,
    conversationMembers: members,
  });
  const conversationRepo = {
    findById: async (id: number) => conversations.find((c) => c.id === id) || null,
    isMember: async (conversationId: number, userId: number) =>
      members.some((m) => m.conversation_id === conversationId && m.user_id === userId),
    canAccessTeamConversation: async () => true,
  };
  const messages: Array<Record<string, any>> = [];
  const messageService = {
    createFileMessage: async (data: Record<string, any>) => {
      const message = {
        id: 500 + messages.length + 1,
        conversation_id: data.conversation_id,
        sender_id: data.sender_id,
        first_name: 'Maya',
        last_name: 'Test',
        content: data.file.file_name,
        type: 'file',
        reply_to: null,
        attachments: [{ file_name: data.file.file_name, file_url: data.file.file_url }],
        notifiedUserIds: [],
      };
      messages.push(message);
      return message;
    },
  };
  const svc = new SharedFileService(
    repo as unknown as SharedFileRepository,
    {
      conversationRepository: conversationRepo as unknown as never,
      messageService: messageService as unknown as never,
    },
  );
  return { svc, repo, messages, messageService };
};

describe('SharedFileService embedInConversation', () => {
  it('posts a file message and grants the conversation access (for a member)', async () => {
    const { svc, repo, messages } = makeEmbedContext();
    const result = await svc.embedInConversation(1, 1, 30);
    assert.equal(result.share.target_type, 'conversation');
    assert.equal(result.share.target_id, 30);
    assert.equal(repo.shares.length, 1);
    assert.equal(result.message.type, 'file');
    assert.equal(result.message.content, 'report.pdf');
    assert.equal(result.message.attachments?.[0]?.file_url, '/uploads/x.pdf');
    assert.equal(messages.length, 1);
  });

  it('rejects embedding when the sender is not part of the conversation', async () => {
    // Public file so the sender passes the file-access gate and the
    // conversation-membership check is what rejects them.
    const ctx = makeEmbedContext({
      users: [EMPLOYEE(1), EMPLOYEE(2), EMPLOYEE(8)],
      files: [BASE_FILE({ is_public: 1 })],
      conversationMembers: [{ conversation_id: 30, user_id: 1 }, { conversation_id: 30, user_id: 2 }],
    });
    await assert.rejects(ctx.svc.embedInConversation(1, 8, 30), /not a member of this conversation/);
    assert.equal(ctx.repo.shares.length, 0);
    assert.equal(ctx.messages.length, 0);
  });

  it('rejects embedding a file the sender cannot access', async () => {
    const ctx = makeEmbedContext({
      users: [EMPLOYEE(1), EMPLOYEE(2), EMPLOYEE(8)],
      files: [BASE_FILE({ is_public: 0, uploaded_by: 2 })],
      conversationMembers: [
        { conversation_id: 30, user_id: 1 },
        { conversation_id: 30, user_id: 2 },
        { conversation_id: 30, user_id: 8 },
      ],
    });
    await assert.rejects(ctx.svc.embedInConversation(1, 8, 30), /do not have permission to access/);
    assert.equal(ctx.repo.shares.length, 0);
    assert.equal(ctx.messages.length, 0);
  });

  it('is idempotent on the access grant but posts a message every time', async () => {
    const { svc, repo, messages } = makeEmbedContext();
    await svc.embedInConversation(1, 1, 30);
    await svc.embedInConversation(1, 1, 30);
    assert.equal(repo.shares.length, 1);
    assert.equal(messages.length, 2);
  });
});
