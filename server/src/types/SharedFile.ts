/**
 * SharedFile types — mirror the `shared_files`, `file_versions`, and
 * `file_permissions` tables plus the joined uploader columns.
 */
export interface SharedFileRow {
  id: number;
  company_id: number;
  /** Non-null when the file lives in a team's file area. */
  team_id: number | null;
  uploaded_by: number;
  file_name: string;
  file_url: string;
  file_type: string | null;
  file_size: number | null;
  description: string | null;
  is_public: number;
  created_at: Date | string;
  updated_at: Date | string;
  // Joined uploader columns
  uploader_first_name?: string;
  uploader_last_name?: string;
  uploader_email?: string;
  uploader_profile_picture?: string | null;
  // Joined team column
  team_name?: string | null;
}

export interface FileVersionRow {
  id: number;
  file_id: number;
  uploaded_by: number;
  file_name: string;
  file_url: string;
  file_type: string | null;
  file_size: number | null;
  change_description: string | null;
  created_at: Date | string;
  // Joined uploader columns
  uploader_first_name?: string;
  uploader_last_name?: string;
  uploader_email?: string;
}

export interface FilePermissionRow {
  id: number;
  file_id: number;
  user_id: number;
  permission: string;
  granted_by: number;
  granted_at: Date | string;
  // Joined user columns
  user_first_name?: string;
  user_last_name?: string;
  user_email?: string;
  user_profile_picture?: string | null;
  // Joined granter columns
  granter_first_name?: string;
  granter_last_name?: string;
}

export interface CreateSharedFileData {
  company_id: number;
  uploaded_by: number;
  /** Team the file is uploaded to — leaves company files when null. */
  team_id?: number | null;
  file_name: string;
  file_url: string;
  file_type?: string | null;
  file_size?: number | null;
  description?: string | null;
  is_public?: boolean;
}

export type FileShareTargetType = 'team' | 'conversation';

export interface FileShareRow {
  id: number;
  file_id: number;
  target_type: FileShareTargetType;
  target_id: number;
  shared_by: number;
  created_at: Date | string;
  // Joined target columns
  target_name?: string | null;
}

export interface CreateFileShareData {
  file_id: number;
  target_type: FileShareTargetType;
  target_id: number;
  shared_by: number;
}

export interface UpdateSharedFileData {
  file_name?: string;
  file_url?: string;
  file_type?: string | null;
  file_size?: number | null;
  description?: string | null;
  is_public?: boolean;
}

export interface CreateFileVersionData {
  file_id: number;
  uploaded_by: number;
  file_name: string;
  file_url: string;
  file_type?: string | null;
  file_size?: number | null;
  change_description?: string | null;
}

export interface CreateFilePermissionData {
  file_id: number;
  user_id: number;
  permission: string;
  granted_by: number;
}

export interface SharedFileFilters {
  companyId?: number;
  userId?: number;
  search?: string;
  fileType?: string;
  isPublic?: boolean;
  page?: number;
  limit?: number;
}
