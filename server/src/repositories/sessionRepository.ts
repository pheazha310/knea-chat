/**
 * SessionRepository — data-access layer for the `user_sessions` and
 * `password_resets` tables (auth-adjacent persistence).
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type { CreatePasswordResetData, CreateSessionData, PasswordResetRow } from '../types';

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

  /** Drop every session for a user (used on logout). */
  async deleteSessionsByUser(userId: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
    return result.affectedRows > 0;
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
