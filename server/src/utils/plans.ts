/**
 * Subscription plans — the product tiers a workspace can be on.
 *
 * Plan rules live here (like `roles.ts`), so the SubscriptionService and the
 * Super Admin console stay in sync without a DB round-trip. Enforcement that
 * touches real data (seat limits, billing fields) is persisted on the
 * `companies` row via the plan columns added in migration 023.
 */

export type PlanKey = 'free' | 'pro' | 'enterprise';

export type PlanStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export interface PlanDef {
  key: PlanKey;
  name: string;
  monthlyPriceUsd: number;
  /** Maximum active users. 0 = unlimited. */
  seatLimit: number;
  description: string;
  features: string[];
}

export const PLANS: Record<PlanKey, PlanDef> = {
  free: {
    key: 'free',
    name: 'Free',
    monthlyPriceUsd: 0,
    seatLimit: 10,
    description: 'For small teams getting started.',
    features: ['Up to 10 users', 'Core chat & teams', 'Community support'],
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    monthlyPriceUsd: 8,
    seatLimit: 50,
    description: 'For growing companies that need room to scale.',
    features: ['Up to 50 users', 'Everything in Free', 'Priority support'],
  },
  enterprise: {
    key: 'enterprise',
    name: 'Enterprise',
    monthlyPriceUsd: 0,
    seatLimit: 0,
    description: 'Unlimited seats for large organizations.',
    features: ['Unlimited users', 'Everything in Pro', 'Dedicated support'],
  },
};

export const PLAN_KEYS = Object.keys(PLANS) as PlanKey[];

export const DEFAULT_PLAN_KEY: PlanKey = 'free';

export const PLAN_STATUSES: PlanStatus[] = ['active', 'trialing', 'past_due', 'canceled'];

export const isPlanKey = (value: unknown): value is PlanKey =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLANS, value);

export const isPlanStatus = (value: unknown): value is PlanStatus =>
  typeof value === 'string' && (PLAN_STATUSES as string[]).includes(value);

/** Throws unless `value` is a known plan key. */
export const assertPlanKey = (value: unknown): PlanKey => {
  if (!isPlanKey(value)) {
    throw new Error(
      `Unknown plan "${String(value)}". Valid plans: ${PLAN_KEYS.join(', ')}`,
    );
  }
  return value;
};

export const getPlan = (key: unknown): PlanDef => PLANS[assertPlanKey(key || DEFAULT_PLAN_KEY)];
