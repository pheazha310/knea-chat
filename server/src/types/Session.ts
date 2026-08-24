/** Session + password-reset types — mirror `user_sessions`/`password_resets`. */

export interface SessionRow {
  id: number;
  user_id: number;
  token_hash: string;
  device_info: string | null;
  ip_address: string | null;
  expires_at: Date | string;
  created_at: Date | string;
}

export interface CreateSessionData {
  user_id: number;
  token_hash: string;
  device_info?: string | null;
  ip_address?: string | null;
  expires_at: Date;
}

export interface PasswordResetRow {
  id: number;
  user_id: number;
  token: string;
  expires_at: Date | string;
  used_at: Date | string | null;
  created_at: Date | string;
}

export interface CreatePasswordResetData {
  user_id: number;
  token: string;
  expires_at: Date;
}
