// Subscription domain model — MVVM Model layer.
// Subscription / plan management: the Super Admin manages every workspace's
// plan (/api/subscriptions); the Company Admin reads their own plan through
// /api/company-settings/plan.
import api from '../services/api';
import type { Company } from './Company';

export interface PlanDef {
  key: 'free' | 'pro' | 'enterprise';
  name: string;
  monthlyPriceUsd: number;
  seatLimit: number; // 0 = unlimited
  description: string;
  features: string[];
}

export interface Subscription {
  plan: PlanDef;
  plan_key: string;
  plan_status: string;
  plan_expires_at?: string | null;
  billing_email?: string | null;
  user_count: number;
  active_user_count: number;
  seats_remaining: number; // -1 = unlimited
  at_seat_limit: boolean;
}

export type SubscriptionCompany = Company & {
  plan_key?: string;
  plan_status?: string;
  plan_expires_at?: string | null;
  billing_email?: string | null;
};

export const SubscriptionModel = {
  /** Every workspace with its plan + usage (Super Admin). */
  list: (params?: Record<string, string>) =>
    api.get<{
      success: boolean;
      data: { subscriptions: SubscriptionCompany[]; plans: PlanDef[] };
    }>('/subscriptions', { params }),
  /** Change a workspace's plan (Super Admin). */
  update: (companyId: number, patch: Partial<Pick<SubscriptionCompany, 'plan_key' | 'plan_status' | 'plan_expires_at' | 'billing_email'>>) =>
    api.patch<{ success: boolean; data: { subscription: Subscription } }>(
      `/subscriptions/${companyId}`,
      patch,
    ),
  /** The Company Admin's own workspace plan. */
  mine: () =>
    api.get<{ success: boolean; data: { subscription: Subscription } }>(
      '/company-settings/plan',
    ),
};
