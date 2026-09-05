/**
 * SessionRepository — data-access layer for the `user_sessions` and
 * `password_resets` tables (auth-adjacent persistence).
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { CreatePasswordResetData, CreateSessionData, PasswordResetRow, SessionRow } from '../types';

export class SessionRepository {
  constructor(private db: Db) {}

  /** Record a login session so tokens can be revoked server-side. */
  async createSession(data: CreateSessionData): Promise<number> {
    const { user_id, token_hash, device_info, ip_address, expires_at } = data;
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO user_sessions (user_id, token_hash, device_info, ip_address, expires_at) VALUES (?, ?, ?, ?, ?)',
      [user_id, token_hash, device_info, ip_address, expires_at],
    );
    return result.insertId;
  }

  /**
   * Soft sign-out: mark every open session as logged out so the login history
   * (device, IP, times) is preserved instead of being deleted.
   */
  async logoutSessionsByUser(userId: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'UPDATE user_sessions SET logged_out_at = NOW() WHERE user_id = ? AND logged_out_at IS NULL',
      [userId],
    );
    return result.affectedRows > 0;
  }

  /** Drop every session for a user (hard cleanup, e.g. account deletion). */
  async deleteSessionsByUser(userId: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
    return result.affectedRows > 0;
  }

  /** Recent login history for a user (newest first) — never exposes token hashes. */
  async listSessionsByUser(userId: number, limit = 20): Promise<SessionRow[]> {
    return this.db.query<SessionRow[]>(
      `SELECT id, user_id, token_hash, device_info, ip_address, created_at, expires_at, logged_out_at
       FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit],
    );
  }

  /** Resolve the row id for a token hash (the caller's current session). */
  async findSessionIdByTokenHash(tokenHash: string): Promise<number | null> {
    const rows = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM user_sessions WHERE token_hash = ? ORDER BY id DESC LIMIT 1',
      [tokenHash],
    );
    return rows[0]?.id ?? null;
  }

  /** Sign out every open session except the given one ("log out other devices"). */
  async logoutOtherSessions(userId: number, excludeSessionId: number): Promise<number> {
    const result = await this.db.query<ResultSetHeader>(
      'UPDATE user_sessions SET logged_out_at = NOW() WHERE user_id = ? AND id <> ? AND logged_out_at IS NULL',
      [userId, excludeSessionId],
    );
    return result.affectedRows;
  }

  /** Persist a password-reset token. */
  async createPasswordReset(data: CreatePasswordResetData): Promise<number> {
    const { user_id, token, expires_at } = data;
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user_id, token, expires_at],
    );
    return result.insertId;
  }

  /** Find an unused, unexpired reset token. */
  async findValidPasswordReset(token: string): Promise<PasswordResetRow | null> {
    const resets = await this.db.query<PasswordResetRow[]>(
      'SELECT * FROM password_resets WHERE token = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1',
      [token],
    );
    return resets[0] || null;
  }

  /** Mark a reset token as used. */
  async markPasswordResetUsed(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
}
