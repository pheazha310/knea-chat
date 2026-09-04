/**
 * SubscriptionService — subscription / plan management (Super Admin console)
 * with seat-limit enforcement for every workspace.
 *
 * The plan lives on the `companies` row (`plan_key`, `plan_status`,
 * `plan_expires_at`, `billing_email`). New organizations start on the Free
 * plan; existing seeded/imported workspaces keep Enterprise so nothing
 * deployed is retroactively capped. Seat limits are enforced wherever a user
 * is added (admin creation + public registration).
 */
import type { CompanyRepository } from '../repositories/companyRepository';
import type { UserRepository } from '../repositories/userRepository';
import { DEFAULT_PLAN_KEY, PLANS, PLAN_KEYS, PLAN_STATUSES, assertPlanKey, getPlan, isPlanStatus } from '../utils/plans';
import type { CompanyRow } from '../types';

export interface PlanUsage {
  plan: (typeof PLANS)[keyof typeof PLANS];
  plan_key: string;
  plan_status: string;
  plan_expires_at: Date | string | null;
  billing_email: string | null;
  user_count: number;
  active_user_count: number;
  seats_remaining: number; // -1 = unlimited
  at_seat_limit: boolean;
}

export class SubscriptionService {
  constructor(
    private companyRepository: CompanyRepository,
    private userRepository: UserRepository,
  ) {}

  /** The plans a Super Admin can assign (catalog with usage defaults). */
  getPlans() {
    return PLAN_KEYS.map((key) => PLANS[key]);
  }

  /** Every company with its current plan + seat usage (Super Admin console). */
  async listSubscriptions(filters: { search?: string } = {}): Promise<CompanyRow[]> {
    return this.companyRepository.findAll(filters);
  }

  /** A company's plan + live usage (Company Admin sees their own). */
  async getCompanySubscription(companyId: number): Promise<PlanUsage> {
    const company = await this.companyRepository.findById(companyId);
    if (!company) {
      throw new Error('Organization not found');
    }
    return this.buildUsage(company);
  }

  /** Change a company's plan / status / billing details (Super Admin only). */
  async setCompanyPlan(
    companyId: number,
    patch: {
      plan_key?: string;
      plan_status?: string;
      plan_expires_at?: Date | string | null;
      billing_email?: string | null;
    },
  ): Promise<PlanUsage> {
    const company = await this.companyRepository.findById(companyId);
    if (!company) {
      throw new Error('Organization not found');
    }
    const updates: Record<string, unknown> = {};
    if (patch.plan_key !== undefined) {
      updates.plan_key = assertPlanKey(patch.plan_key);
    }
    if (patch.plan_status !== undefined) {
      if (!isPlanStatus(patch.plan_status)) {
        throw new Error(`Unknown plan status "${patch.plan_status}". Valid: ${PLAN_STATUSES.join(', ')}`);
      }
      updates.plan_status = patch.plan_status;
    }
    if (patch.plan_expires_at !== undefined) {
      updates.plan_expires_at = patch.plan_expires_at ? new Date(String(patch.plan_expires_at)) : null;
    }
    if (patch.billing_email !== undefined) {
      updates.billing_email = patch.billing_email ? String(patch.billing_email).trim() : null;
    }
    if (Object.keys(updates).length === 0) {
      throw new Error('No plan changes provided');
    }
    const ok = await this.companyRepository.update(companyId, updates);
    if (!ok) throw new Error('Failed to update organization plan');
    const refreshed = await this.companyRepository.findById(companyId);
    if (!refreshed) throw new Error('Organization not found');
    return this.buildUsage(refreshed);
  }

  /**
   * Enforce the plan seat limit. Called before creating a user (admin
   * console) and before public registration. Throws when the workspace is at
   * capacity. A canceled subscription also blocks new users.
   */
  async assertCanAddUser(companyId: number): Promise<PlanUsage> {
    const company = await this.companyRepository.findById(companyId);
    if (!company) {
      throw new Error('Organization not found');
    }
    const usage = await this.buildUsage(company);
    if (usage.plan_status === 'canceled') {
      throw new Error('This workspace subscription has been canceled — new users cannot be added.');
    }
    if (usage.at_seat_limit) {
      throw new Error(
        `This workspace has reached the ${usage.plan.name} plan limit of ${usage.plan.seatLimit} users. ` +
          'Contact the platform administrator to upgrade.',
      );
    }
    return usage;
  }

  private async buildUsage(company: CompanyRow): Promise<PlanUsage> {
    const planKey = (company as CompanyRow & { plan_key?: string }).plan_key || DEFAULT_PLAN_KEY;
    const plan = getPlan(planKey);
    const userCount = Number(company.user_count ?? 0);
    const activeUserCount = Number(company.active_user_count ?? 0);
    const seatLimit = plan.seatLimit;
    return {
      plan,
      plan_key: planKey,
      plan_status: (company as CompanyRow & { plan_status?: string }).plan_status || 'active',
      plan_expires_at: (company as CompanyRow & { plan_expires_at?: Date | string | null }).plan_expires_at ?? null,
      billing_email: (company as CompanyRow & { billing_email?: string | null }).billing_email ?? null,
      user_count: userCount,
      active_user_count: activeUserCount,
      seats_remaining: seatLimit === 0 ? -1 : Math.max(seatLimit - userCount, 0),
      at_seat_limit: seatLimit > 0 && userCount >= seatLimit,
    };
  }

  /** Convenience used by tests: force-read the current user count live. */
  async refreshUsage(companyId: number): Promise<PlanUsage> {
    const company = await this.companyRepository.findById(companyId);
    if (!company) throw new Error('Organization not found');
    const count = await this.userRepository.countByCompany(companyId);
    return this.buildUsage({ ...company, user_count: count });
  }
}
