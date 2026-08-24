/**
 * SharedFileService — business logic for shared files (upload, list, download,
 * versioning, permissions, search).
 */
import type { SharedFileRepository } from '../repositories/sharedFileRepository';
import type {
  CreateFilePermissionData,
  CreateFileVersionData,
  CreateSharedFileData,
  FilePermissionRow,
  FileVersionRow,
  SharedFileFilters,
  SharedFileRow,
  UpdateSharedFileData,
} from '../types';

export class SharedFileService {
  constructor(private sharedFileRepository: SharedFileRepository) {}

  async createSharedFile(data: CreateSharedFileData): Promise<SharedFileRow> {
    const { company_id, uploaded_by, file_name, file_url, file_type, file_size, description, is_public } = data;

    const fileId = await this.sharedFileRepository.create({
      company_id,
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
