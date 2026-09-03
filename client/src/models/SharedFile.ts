// SharedFile domain model — MVVM Model layer.
// Holds the shared file entities plus `SharedFileModel`, the data access for the
// /shared-files endpoints.
import api, { API_BASE_URL } from '../services/api';

export interface SharedFile {
  id: number;
  company_id: number;
  /** Team whose file area this file lives in (null = company files). */
  team_id?: number | null;
  uploaded_by: number;
  file_name: string;
  file_url: string;
  file_type?: string | null;
  file_size?: number | null;
  description?: string | null;
  is_public?: boolean;
  created_at: string;
  updated_at: string;
  uploader_first_name?: string;
  uploader_last_name?: string;
  uploader_email?: string;
  uploader_profile_picture?: string | null;
  team_name?: string | null;
}

export type FileShareTargetType = 'team' | 'conversation';

export interface FileShare {
  id: number;
  file_id: number;
  target_type: FileShareTargetType;
  target_id: number;
  shared_by: number;
  created_at: string;
  target_name?: string | null;
}

export interface FileVersion {
  id: number;
  file_id: number;
  uploaded_by: number;
  file_name: string;
  file_url: string;
  file_type?: string | null;
  file_size?: number | null;
  change_description?: string | null;
  created_at: string;
  uploader_first_name?: string;
  uploader_last_name?: string;
  uploader_email?: string;
}

export interface FilePermission {
  id: number;
  file_id: number;
  user_id: number;
  permission: string;
  granted_by: number;
  granted_at: string;
  user_first_name?: string;
  user_last_name?: string;
  user_email?: string;
  user_profile_picture?: string | null;
  granter_first_name?: string;
  granter_last_name?: string;
}

export const SharedFileModel = {
  upload: (formData: FormData, onProgress?: (pct: number) => void) => {
    return api.post<{ success: boolean; data: { file: SharedFile } }>(
      '/shared-files/upload',
      formData,
      {
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      },
    );
  },

  getAll: (params?: { search?: string; fileType?: string; isPublic?: boolean; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.fileType) query.set('fileType', params.fileType);
    if (params?.isPublic !== undefined) query.set('isPublic', String(params.isPublic));
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return api.get<{ success: boolean; data: { files: SharedFile[]; total: number } }>(
      `/shared-files${qs ? `?${qs}` : ''}`,
    );
  },

  getTeamFiles: (teamId: number, params?: { search?: string; fileType?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.fileType) query.set('fileType', params.fileType);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return api.get<{ success: boolean; data: { files: SharedFile[]; total: number } }>(
      `/shared-files/team/${teamId}${qs ? `?${qs}` : ''}`,
    );
  },

  getShares: (fileId: number) =>
    api.get<{ success: boolean; data: { shares: FileShare[] } }>(
      `/shared-files/${fileId}/shares`,
    ),

  shareFile: (fileId: number, target_type: FileShareTargetType, target_id: number) =>
    api.post<{ success: boolean; data: { share: FileShare } }>(
      `/shared-files/${fileId}/shares`,
      { target_type, target_id },
    ),

  /** Post the file into a conversation as a chat message. */
  embedFile: (fileId: number, conversationId: number) =>
    api.post<{
      success: boolean;
      data: { share: FileShare; message: { id: number } };
    }>(`/shared-files/${fileId}/embed`, { conversation_id: conversationId }),

  unshareFile: (fileId: number, shareId: number) =>
    api.delete<{ success: boolean; message: string }>(
      `/shared-files/${fileId}/shares/${shareId}`,
    ),

  getById: (id: number) =>
    api.get<{ success: boolean; data: { file: SharedFile } }>(`/shared-files/${id}`),

  update: (id: number, data: { file_name?: string; description?: string | null; is_public?: boolean }) =>
    api.patch<{ success: boolean; data: { file: SharedFile } }>(`/shared-files/${id}`, data),

  remove: (id: number) =>
    api.delete<{ success: boolean; message: string }>(`/shared-files/${id}`),

  uploadVersion: (id: number, formData: FormData, onProgress?: (pct: number) => void) => {
    return api.post<{ success: boolean; data: { version: FileVersion } }>(
      `/shared-files/${id}/versions`,
      formData,
      {
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      },
    );
  },

  getVersions: (id: number) =>
    api.get<{ success: boolean; data: { versions: FileVersion[] } }>(`/shared-files/${id}/versions`),

  getPermissions: (id: number) =>
    api.get<{ success: boolean; data: { permissions: FilePermission[] } }>(`/shared-files/${id}/permissions`),

  grantPermission: (id: number, user_id: number, permission: string) =>
    api.post<{ success: boolean; data: { permission: FilePermission } }>(
      `/shared-files/${id}/permissions`,
      { user_id, permission },
    ),

  revokePermission: (id: number, userId: number) =>
    api.delete<{ success: boolean; message: string }>(`/shared-files/${id}/permissions/${userId}`),

  search: (params: { q: string; fileType?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    query.set('q', params.q);
    if (params.fileType) query.set('fileType', params.fileType);
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    return api.get<{ success: boolean; data: { files: SharedFile[]; total: number } }>(
      `/shared-files/search?${query.toString()}`,
    );
  },

  download: (id: number) =>
    api.get(`/shared-files/${id}/download`, { responseType: 'blob' }),
};

export const resolveSharedFileUrl = (fileUrl: string) => {
  if (/^https?:\/\//.test(fileUrl)) return fileUrl;
  const origin = API_BASE_URL.replace(/\/api$/, '');
  return `${origin}${fileUrl}`;
};
