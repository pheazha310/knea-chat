/** Platform-wide settings — typed map produced by SystemSettingService. */

export interface SystemSettings {
  maintenance_mode: boolean;
  allow_public_registration: boolean;
  password_min_length: number;
  max_upload_size_mb: number;
  max_users_per_org: number;
  allow_uploads: boolean;
  allow_reactions: boolean;
  allow_pinning: boolean;
}
