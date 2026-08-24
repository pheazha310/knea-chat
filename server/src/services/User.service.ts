/**
 * UserService — business logic for user management.
 */
import bcrypt from 'bcrypt';
import type { UserRepository } from '../repositories/userRepository';
import { ROLES, canAssignRole, isAtLeast } from '../utils/roles';
import type { AuthUser, CreateUserData, UpdateUserData, User, UserRow } from '../types';

export class UserService {
  constructor(private userRepository: UserRepository) {}

  async getUsers(filters: {
    companyId: number;
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    department_id?: string;
  }): Promise<{ users: UserRow[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const { companyId, page = 1, limit = 20, search = '', role = '', department_id = '' } = filters;

    const users = await this.userRepository.findAll({
      companyId,
      page: parseInt(String(page)),
      limit: parseInt(String(limit)),
      search,
      role,
      department_id,
    });

    const total = await this.userRepository.countByCompany(companyId);

    return {
      users,
      pagination: {
        page: parseInt(String(page)),
        limit: parseInt(String(limit)),
        total,
        totalPages: Math.ceil(total / parseInt(String(limit))),
      },
    };
  }

  async getUser(id: number): Promise<UserRow> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new Error('User not found');
    }
    return user;
  }

  async createUser(data: CreateUserData, requester: AuthUser | null = null): Promise<User> {
    const { email, password, first_name, last_name, company_id, role, job_title, department_id } = data;

    const existing = await this.userRepository.findByEmail(email);
    if (existing) {
      throw new Error('Email already exists');
    }

    const targetRole = role || ROLES.EMPLOYEE;
    if (requester && !canAssignRole(requester.role, targetRole)) {
      throw new Error('You do not have permission to assign this role');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = await this.userRepository.create({
      company_id,
      email,
      password: hashedPassword,
      first_name,
      last_name,
      role: targetRole,
      job_title,
      department_id,
    });

    const user = await this.userRepository.findById(userId);
    if (!user) throw new Error('User not found');
    const { password: _password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async updateUser(
    id: number,
    data: UpdateUserData,
    requesterId: number,
    requesterRole: string,
    requesterCompanyId: number | undefined,
  ): Promise<UserRow> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new Error('User not found');
    }

    const isSelf = Number(requesterId) === Number(id);
    const isSuperAdmin = requesterRole === ROLES.SUPER_ADMIN;

    if (!isSelf && !isSuperAdmin && !isAtLeast(requesterRole, ROLES.ADMIN)) {
      throw new Error('Unauthorized');
    }

    // Company admins manage people inside their own company only.
    if (
      !isSelf &&
      !isSuperAdmin &&
      requesterCompanyId !== undefined &&
      Number(requesterCompanyId) !== Number(user.company_id)
    ) {
      throw new Error('Unauthorized');
    }

    // Only a super admin may change a super admin account.
    if (user.role === ROLES.SUPER_ADMIN && !isSuperAdmin) {
      throw new Error('Only a Super Admin can manage super admin accounts');
    }

    // Role and activation changes are admin-only (SRS US-18, US-20), and
    // assigning/promoting to super_admin is reserved for super admins.
    if (data.role !== undefined) {
      if (!isAtLeast(requesterRole, ROLES.ADMIN)) {
        throw new Error('Only administrators can change roles');
      }
      if (!canAssignRole(requesterRole, data.role)) {
        throw new Error('You do not have permission to assign this role');
      }
    }
    if (data.is_active !== undefined && !isAtLeast(requesterRole, ROLES.ADMIN)) {
      throw new Error('Only administrators can activate or disable accounts');
    }

    const updated = await this.userRepository.update(id, data);
    if (!updated) {
      throw new Error('Failed to update user');
    }

    const refreshed = await this.userRepository.findById(id);
    if (!refreshed) throw new Error('User not found');
    return refreshed;
  }

  async deleteUser(id: number, requester: AuthUser | null = null): Promise<{ message: string }> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new Error('User not found');
    }

    const isSuperAdmin = requester && requester.role === ROLES.SUPER_ADMIN;

    // Super admin accounts can only be removed by another super admin.
    if (user.role === ROLES.SUPER_ADMIN && !isSuperAdmin) {
      throw new Error('Only a Super Admin can delete super admin accounts');
    }

    // Company admins manage people inside their own company only.
    if (
      requester &&
      !isSuperAdmin &&
      requester.companyId !== undefined &&
      Number(requester.companyId) !== Number(user.company_id)
    ) {
      throw new Error('Unauthorized');
    }

    const deleted = await this.userRepository.softDelete(id);
    if (!deleted) {
      throw new Error('Failed to delete user');
    }

    return { message: 'User deleted successfully' };
  }

  /** Admin-only: restore a disabled account (US-20). */
  async restoreUser(id: number): Promise<{ message: string }> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new Error('User not found');
    }

    await this.userRepository.update(id, { is_active: 1 });
    return { message: 'User account re-enabled' };
  }

  async searchUsers(companyId: number, search: string, limit = 20): Promise<UserRow[]> {
    return this.userRepository.search(companyId, search, limit);
  }
}
