/**
 * SharedFileService — business logic for shared files (upload, list, download,
 * versioning, permissions, search).
 */
import type { SharedFileRepository } from '../repositories/sharedFileRepository';
import type {
  CreateFilePermissionData,
  CreateFileShareData,
  CreateFileVersionData,
  CreateSharedFileData,
  FilePermissionRow,
  FileShareRow,
  FileVersionRow,
  OutgoingMessage,
  SharedFileFilters,
  SharedFileRow,
  UpdateSharedFileData,
} from '../types';
import type { ConversationRepository } from '../repositories/conversationRepository';
import type { MessageService } from './Message.service';

/** Roles that may view/upload files across their whole company. */
const PRIVILEGED_ROLES = ['super_admin', 'admin', 'manager'];

export class SharedFileService {
  constructor(
    private sharedFileRepository: SharedFileRepository,
    /** Chat integration (embedding files as messages) — optional so file-only
     *  consumers and tests can construct the service without it. */
    private deps: {
      conversationRepository: ConversationRepository;
      messageService: MessageService;
    } | null = null,
  ) {}

  /** Company-scoped manager/admin/super-admin check for a given user. */
  private async isPrivilegedIn(companyId: number, userId: number): Promise<boolean> {
    const user = await this.sharedFileRepository.findUserRole(userId);
    return !!user && user.company_id === companyId && PRIVILEGED_ROLES.includes(user.role);
  }

  /** Owner or granted 'manage' permission on a file. */
  private async canManageFile(fileId: number, userId: number): Promise<boolean> {
    const isOwner = await this.sharedFileRepository.isOwner(fileId, userId);
    if (isOwner) return true;
    const userPerm = await this.sharedFileRepository.findUserPermission(fileId, userId);
    return !!userPerm && userPerm.permission === 'manage';
  }

  /** Uploading into a team's file area is restricted to team members + managers. */
  private async assertCanUploadToTeam(teamId: number, userId: number): Promise<void> {
    const team = await this.sharedFileRepository.findTeam(teamId);
    if (!team) {
      throw new Error('Team not found');
    }
    if (await this.isPrivilegedIn(team.company_id, userId)) return;
    const member = await this.sharedFileRepository.isTeamMember(teamId, userId);
    if (!member) {
      throw new Error('Only team members can upload files to a team');
    }
  }

  async createSharedFile(data: CreateSharedFileData): Promise<SharedFileRow> {
    const { company_id, uploaded_by, file_name, file_url, file_type, file_size, description } = data;
    const team_id = data.team_id ?? null;

    if (team_id) {
      await this.assertCanUploadToTeam(team_id, uploaded_by);
    }

    // Team uploads stay inside the team — never leak to the company-wide
    // public area implicitly. Company uploads keep the caller's flag.
    const is_public = team_id ? false : !!data.is_public;

    const fileId = await this.sharedFileRepository.create({
      company_id,
      team_id,
      uploaded_by,
      file_name,
      file_url,
      file_type,
      file_size,
      description,
      is_public,
    });

    const file = await this.sharedFileRepository.findById(fileId);
    if (!file) {
      throw new Error('Failed to create shared file');
    }

    if (is_public) {
      await this.sharedFileRepository.createPermission({
        file_id: fileId,
        user_id: uploaded_by,
        permission: 'manage',
        granted_by: uploaded_by,
      });
    }

    return file;
  }

  async getSharedFile(id: number, userId: number): Promise<SharedFileRow> {
    const file = await this.sharedFileRepository.findById(id);
    if (!file) {
      throw new Error('File not found');
    }

    const canAccess = await this.sharedFileRepository.canAccess(id, userId);
    if (!canAccess) {
      throw new Error('You do not have permission to access this file');
    }

    return file;
  }

  /**
   * Files in a team's file area (uploaded there or shared to it). Only team
   * members and that team's company managers/admins may list them.
   */
  async listTeamFiles(
    teamId: number,
    userId: number,
    filters: SharedFileFilters = {},
  ): Promise<{ files: SharedFileRow[]; total: number }> {
    const team = await this.sharedFileRepository.findTeam(teamId);
    if (!team) {
      throw new Error('Team not found');
    }
    const privileged = await this.isPrivilegedIn(team.company_id, userId);
    if (!privileged && !(await this.sharedFileRepository.isTeamMember(teamId, userId))) {
      throw new Error('You must be a member of this team to view its files');
    }
    return this.sharedFileRepository.findTeamFiles(teamId, team.company_id, filters);
  }

  // ---------------------------------------------------------------------------
  // Sharing — destination-based access (teams and conversations)
  // ---------------------------------------------------------------------------

  async getFileShares(fileId: number, userId: number): Promise<FileShareRow[]> {
    await this.getSharedFile(fileId, userId);
    return this.sharedFileRepository.findShares(fileId);
  }

  async shareFile(
    fileId: number,
    userId: number,
    targetType: string,
    targetId: number,
  ): Promise<FileShareRow> {
    const file = await this.sharedFileRepository.findById(fileId);
    if (!file) {
      throw new Error('File not found');
    }
    if (!(await this.canManageFile(fileId, userId))) {
      throw new Error('You do not have permission to share this file');
    }

    if (targetType !== 'team' && targetType !== 'conversation') {
      throw new Error('target_type must be "team" or "conversation"');
    }

    if (targetType === 'team') {
      const team = await this.sharedFileRepository.findTeam(targetId);
      if (!team) {
        throw new Error('Team not found');
      }
      if (team.company_id !== file.company_id) {
        throw new Error('You can only share a file with teams in the same company');
      }
      const privileged = await this.isPrivilegedIn(team.company_id, userId);
      const member = await this.sharedFileRepository.isTeamMember(targetId, userId);
      if (!privileged && !member) {
        throw new Error('You must be a member of the team to share files with it');
      }
    } else {
      const conversation = await this.sharedFileRepository.findConversation(targetId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      const privileged = await this.isPrivilegedIn(file.company_id, userId);
      const member = await this.sharedFileRepository.isConversationMember(targetId, userId);
      if (!privileged && !member) {
        throw new Error('You must be part of the conversation to share files with it');
      }
    }

    const data: CreateFileShareData = {
      file_id: fileId,
      target_type: targetType as CreateFileShareData['target_type'],
      target_id: targetId,
      shared_by: userId,
    };
    await this.sharedFileRepository.createShare(data);

    const share = await this.sharedFileRepository.findShareByTarget(fileId, targetType, targetId);
    if (!share) {
      throw new Error('Failed to share file');
    }
    return share;
  }

  async unshareFile(shareId: number, userId: number): Promise<void> {
    const share = await this.sharedFileRepository.findShareById(shareId);
    if (!share) {
      throw new Error('Share not found');
    }
    const canManage = await this.canManageFile(share.file_id, userId);
    if (!canManage && share.shared_by !== userId) {
      throw new Error('You do not have permission to unshare this file');
    }
    const removed = await this.sharedFileRepository.removeShare(shareId);
    if (!removed) {
      throw new Error('Share not found');
    }
  }

  // ---------------------------------------------------------------------------
  // Embedding — share a file INTO a conversation as a chat message
  // ---------------------------------------------------------------------------

  /**
   * Share a file into a conversation as a chat message ("embed"). Anyone who
   * can already access the file and is part of the target conversation may do
   * this. Grants the conversation's members direct access to the file (so
   * previews/versions work) and posts a `file`-type message that appears in
   * the chat and broadcasts to members like any other message.
   */
  async embedInConversation(
    fileId: number,
    userId: number,
    conversationId: number,
  ): Promise<{ file: SharedFileRow; message: OutgoingMessage; share: FileShareRow }> {
    if (!this.deps) {
      throw new Error('Chat integration is unavailable');
    }
    const { conversationRepository, messageService } = this.deps;

    // Sender must be able to open the file (public, owner, team/shared access).
    const file = await this.getSharedFile(fileId, userId);

    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    // Mirror MessageService's conversation access rules: team conversations
    // are for team members + managers, everything else needs membership.
    if (conversation.type === 'team') {
      const ok = await conversationRepository.canAccessTeamConversation(
        conversation.name || '',
        userId,
      );
      if (!ok) {
        throw new Error('You must be a member of this team to access its conversation');
      }
    } else {
      const isMember = await conversationRepository.isMember(conversationId, userId);
      if (!isMember) {
        throw new Error('You are not a member of this conversation');
      }
    }

    // Upsert is idempotent — embedding twice posts two messages but only one
    // access grant.
    await this.sharedFileRepository.createShare({
      file_id: fileId,
      target_type: 'conversation',
      target_id: conversationId,
      shared_by: userId,
    });
    const share = await this.sharedFileRepository.findShareByTarget(fileId, 'conversation', conversationId);
    if (!share) {
      throw new Error('Failed to share file with conversation');
    }

    // The chat message references the file's stored bytes like any uploaded
    // attachment, so the existing message UI renders it unchanged.
    const message = await messageService.createFileMessage({
      conversation_id: conversationId,
      sender_id: userId,
      file: {
        file_name: file.file_name,
        file_url: file.file_url,
        file_type: file.file_type,
        file_size: file.file_size,
      },
    });

    return { file, message, share };
  }

  async listSharedFiles(filters: SharedFileFilters & { userId: number }): Promise<{ files: SharedFileRow[]; total: number }> {
    const { companyId, userId, search, fileType, isPublic, page = 1, limit = 20 } = filters;

    let publicOnly = isPublic !== undefined ? isPublic : undefined;
    if (publicOnly === undefined) {
      publicOnly = true;
    }

    const files = await this.sharedFileRepository.findAll({
      companyId,
      userId,
      search,
      fileType,
      isPublic: publicOnly,
      page,
      limit,
    });

    return files;
  }

  async listAccessibleFiles(filters: SharedFileFilters & { userId: number }): Promise<{ files: SharedFileRow[]; total: number }> {
    const { companyId, userId, search, fileType, page = 1, limit = 20 } = filters;

    const allFiles = await this.sharedFileRepository.findAll({
      companyId,
      search,
      fileType,
      page: 1,
      limit: 1000,
    });

    const accessibleFiles = allFiles.files.filter((file) =>
      this.sharedFileRepository.canAccess(file.id, userId),
    );

    const start = (parseInt(String(page)) - 1) * parseInt(String(limit));
    const paginated = accessibleFiles.slice(start, start + parseInt(String(limit)));

    return { files: paginated, total: accessibleFiles.length };
  }

  async updateSharedFile(id: number, data: UpdateSharedFileData, userId: number): Promise<SharedFileRow> {
    const file = await this.sharedFileRepository.findById(id);
    if (!file) {
      throw new Error('File not found');
    }

    const isOwner = await this.sharedFileRepository.isOwner(id, userId);
    const userPerm = await this.sharedFileRepository.findUserPermission(id, userId);
    const canEdit = isOwner || (userPerm && ['edit', 'manage'].includes(userPerm.permission));

    if (!canEdit) {
      throw new Error('You do not have permission to edit this file');
    }

    const updated = await this.sharedFileRepository.update(id, data);
    if (!updated) {
      throw new Error('Failed to update file');
    }

    const refreshed = await this.sharedFileRepository.findById(id);
    if (!refreshed) throw new Error('File not found');
    return refreshed;
  }

  async deleteSharedFile(id: number, userId: number): Promise<void> {
    const file = await this.sharedFileRepository.findById(id);
    if (!file) {
      throw new Error('File not found');
    }

    const isOwner = await this.sharedFileRepository.isOwner(id, userId);
    const userPerm = await this.sharedFileRepository.findUserPermission(id, userId);
    const canDelete = isOwner || (userPerm && ['delete', 'manage'].includes(userPerm.permission));

    if (!canDelete) {
      throw new Error('You do not have permission to delete this file');
    }

    await this.sharedFileRepository.delete(id);
  }

  async uploadNewVersion(data: CreateFileVersionData): Promise<FileVersionRow> {
    const { file_id, uploaded_by, file_name, file_url, file_type, file_size, change_description } = data;

    const file = await this.sharedFileRepository.findById(file_id);
    if (!file) {
      throw new Error('File not found');
    }

    const isOwner = await this.sharedFileRepository.isOwner(file_id, uploaded_by);
    const userPerm = await this.sharedFileRepository.findUserPermission(file_id, uploaded_by);
    const canEdit = isOwner || (userPerm && ['edit', 'manage'].includes(userPerm.permission));

    if (!canEdit) {
      throw new Error('You do not have permission to upload a new version');
    }

    const versionId = await this.sharedFileRepository.createVersion({
      file_id,
      uploaded_by,
      file_name,
      file_url,
      file_type,
      file_size,
      change_description,
    });

    await this.sharedFileRepository.update(file_id, { file_name, file_url, file_type, file_size });

    const version = await this.sharedFileRepository.findVersionById(versionId);
    if (!version) {
      throw new Error('Failed to create file version');
    }

    return version;
  }

  async getFileVersions(fileId: number, userId: number): Promise<FileVersionRow[]> {
    const canAccess = await this.sharedFileRepository.canAccess(fileId, userId);
    if (!canAccess) {
      throw new Error('You do not have permission to access this file');
    }

    return this.sharedFileRepository.findVersions(fileId);
  }

  async getFilePermissions(fileId: number, userId: number): Promise<FilePermissionRow[]> {
    const file = await this.sharedFileRepository.findById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    const isOwner = await this.sharedFileRepository.isOwner(fileId, userId);
    const userPerm = await this.sharedFileRepository.findUserPermission(fileId, userId);
    const canManage = isOwner || (userPerm && userPerm.permission === 'manage');

    if (!canManage) {
      throw new Error('You do not have permission to view file permissions');
    }

    return this.sharedFileRepository.findPermissions(fileId);
  }

  async grantPermission(data: CreateFilePermissionData): Promise<FilePermissionRow> {
    const { file_id, user_id, permission, granted_by } = data;

    const file = await this.sharedFileRepository.findById(file_id);
    if (!file) {
      throw new Error('File not found');
    }

    const isOwner = await this.sharedFileRepository.isOwner(file_id, granted_by);
    const granterPerm = await this.sharedFileRepository.findUserPermission(file_id, granted_by);
    const canManage = isOwner || (granterPerm && granterPerm.permission === 'manage');

    if (!canManage) {
      throw new Error('You do not have permission to manage file permissions');
    }

    const permId = await this.sharedFileRepository.createPermission({ file_id, user_id, permission, granted_by });

    const perm = await this.sharedFileRepository.findUserPermission(file_id, user_id);
    if (!perm) {
      throw new Error('Failed to grant permission');
    }

    return perm;
  }

  async revokePermission(fileId: number, userId: number, requesterId: number): Promise<void> {
    const file = await this.sharedFileRepository.findById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    const isOwner = await this.sharedFileRepository.isOwner(fileId, requesterId);
    const requesterPerm = await this.sharedFileRepository.findUserPermission(fileId, requesterId);
    const canManage = isOwner || (requesterPerm && requesterPerm.permission === 'manage');

    if (!canManage) {
      throw new Error('You do not have permission to revoke permissions');
    }

    const removed = await this.sharedFileRepository.removePermission(fileId, userId);
    if (!removed) {
      throw new Error('Permission not found');
    }
  }

  async searchFiles(companyId: number, search: string, filters: SharedFileFilters = {}): Promise<SharedFileRow[]> {
    const { fileType, page = 1, limit = 20 } = filters;
    return this.sharedFileRepository.search(companyId, search, { companyId, fileType, page, limit });
  }

  async downloadFile(id: number, userId: number): Promise<{ file: SharedFileRow }> {
    const file = await this.getSharedFile(id, userId);
    return { file };
  }
}
