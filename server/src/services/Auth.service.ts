/**
 * AuthService — business logic for authentication.
 * Validates credentials, verifies bcrypt hashes, issues JWTs, and persists
 * sessions through repositories. Never exposes password hashes or secrets.
 */
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { UserRepository } from '../repositories/userRepository';
import type { NotificationRepository } from '../repositories/notificationRepository';
import type { CompanyRepository } from '../repositories/companyRepository';
import type { SessionRepository } from '../repositories/sessionRepository';
import { generateToken } from '../utils/auth.utils';
import type { CompanySettingService } from './CompanySetting.service';
import type { SubscriptionService } from './Subscription.service';
import type { LoginResult, SystemSettings, User, UserRow } from '../types';

/** Platform-neutral baseline used when only the company policy matters. */
const NEUTRAL_PLATFORM = {
  allow_uploads: true,
  allow_reactions: true,
  allow_pinning: true,
  max_upload_size_mb: 10,
  password_min_length: 0,
};

export class AuthService {
  constructor(
    private userRepository: UserRepository,
    private notificationRepository: NotificationRepository,
    private companyRepository: CompanyRepository,
    private sessionRepository: SessionRepository,
    private subscriptionService?: SubscriptionService | null,
    private companySettingService?: CompanySettingService | null,
  ) {}

  /** Effective workspace password minimum for a user's company (default 6). */
  private async companyMinPassword(user: UserRow): Promise<number> {
    if (!this.companySettingService || !user.company_id) return 0;
    try {
      const policy = await this.companySettingService.effectiveFeaturePolicy(
        Number(user.company_id),
        NEUTRAL_PLATFORM,
      );
      return policy.password_min_length;
    } catch {
      return 0;
    }
  }

  async register(
    { firstName, lastName, email, password }: { firstName: string; lastName: string; email: string; password: string },
    ipAddress: string | null = null,
    deviceInfo: string | null = null,
    settings: SystemSettings | null = null,
  ): Promise<LoginResult> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!firstName?.trim() || !lastName?.trim() || !normalizedEmail || !password) {
      throw new Error('First name, last name, email, and password are required');
    }

    const minPasswordLength = settings?.password_min_length ?? 6;
    if (password.length < minPasswordLength) {
      throw new Error(`Password must be at least ${minPasswordLength} characters`);
    }

    if (await this.userRepository.findByEmail(normalizedEmail)) {
      throw new Error('An account with this email already exists');
    }

    let company = await this.companyRepository.findByDomain('kneachat.com');
    if (!company) {
      const companyId = await this.companyRepository.create({ name: 'KneaChat', domain: 'kneachat.com' });
      company = { id: companyId } as NonNullable<typeof company>;
    }

    // Platform limit on users per organization (0 = unlimited).
    const maxUsersPerOrg = settings?.max_users_per_org || 0;
    if (maxUsersPerOrg > 0) {
      const userCount = await this.userRepository.countByCompany(company.id);
      if (userCount >= maxUsersPerOrg) {
        throw new Error(
          `This workspace has reached its limit of ${maxUsersPerOrg} users.`,
        );
      }
    }

    // Subscription plan seat limit (Administration module).
    if (this.subscriptionService) {
      await this.subscriptionService.assertCanAddUser(company.id);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await this.userRepository.create({
      company_id: company.id,
      department_id: null,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: normalizedEmail,
      password: passwordHash,
      role: 'employee',
      job_title: null,
    });
    return this.login(normalizedEmail, password, ipAddress, deviceInfo);
  }

  async login(
    email: string,
    password: string,
    ipAddress: string | null = null,
    deviceInfo: string | null = null,
  ): Promise<LoginResult> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new Error('Invalid email or password');
    }

    if (!user.is_active) {
      throw new Error('Account is disabled. Contact administrator.');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password || '');
    if (!isPasswordValid) {
      throw new Error('Invalid email or password');
    }

    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.company_id ?? 0,
    };

    const token = generateToken(tokenPayload, '24h');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await this.sessionRepository.createSession({
      user_id: user.id,
      token_hash: tokenHash,
      device_info: deviceInfo,
      ip_address: ipAddress,
      expires_at: expiresAt,
    });

    await this.userRepository.updateStatus(user.id, 'online');

    const { password: _password, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      token,
      expiresIn: '24h',
    };
  }

  async refreshToken(userId: number): Promise<{ token: string; expiresIn: string }> {
    const user = await this.userRepository.findById(userId);
    if (!user || !user.is_active) {
      throw new Error('User not found or account disabled');
    }

    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.company_id ?? 0,
    };

    const token = generateToken(tokenPayload, '24h');
    return { token, expiresIn: '24h' };
  }

  async logout(userId: number): Promise<void> {
    await this.userRepository.updateStatus(userId, 'offline');
    await this.sessionRepository.deleteSessionsByUser(userId);
  }

  async forgotPassword(email: string): Promise<{ message: string; resetToken?: string }> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      return { message: 'If an account exists with this email, a password reset link will be sent' };
    }

    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    await this.sessionRepository.createPasswordReset({
      user_id: user.id,
      token,
      expires_at: expiresAt,
    });

    await this.notificationRepository.create({
      user_id: user.id,
      type: 'password_reset',
      title: 'Password Reset Request',
      message: 'A password reset was requested for your account.',
      data: { token },
    });

    return { message: 'If an account exists with this email, a password reset link will be sent', resetToken: token };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const reset = await this.sessionRepository.findValidPasswordReset(token);
    if (!reset) {
      throw new Error('Invalid or expired reset token');
    }

    // The workspace policy may demand a longer password than the platform
    // minimum the controller already enforced.
    const user = await this.userRepository.findById(reset.user_id);
    const companyMin = user ? await this.companyMinPassword(user) : 0;
    if (newPassword.length < companyMin) {
      throw new Error(`Password must be at least ${companyMin} characters`);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.userRepository.updatePassword(reset.user_id, hashedPassword);
    await this.sessionRepository.markPasswordResetUsed(reset.id);

    return { message: 'Password has been reset successfully' };
  }

  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password || '');
    if (!isPasswordValid) {
      throw new Error('Current password is incorrect');
    }

    // The workspace policy may demand a longer password than the platform
    // minimum the controller already enforced.
    const companyMin = await this.companyMinPassword(user);
    if (newPassword.length < companyMin) {
      throw new Error(`Password must be at least ${companyMin} characters`);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.userRepository.updatePassword(userId, hashedPassword);
    return { message: 'Password changed successfully' };
  }
}

export type { User };
