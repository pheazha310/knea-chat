'use strict';

/**
 * SubscriptionService — plan management with seat-limit enforcement.
 *   - new organizations are Free (10 seats); Enterprise is unlimited
 *   - assertCanAddUser blocks creation at the seat limit and when canceled
 *   - setCompanyPlan validates plan keys/statuses and persists on the company
 *   - the Super Admin list surfaces every workspace with live usage
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SubscriptionService } from '../src/services/Subscription.service';
import type { CompanyRepository } from '../src/repositories/companyRepository';
import type { UserRepository } from '../src/repositories/userRepository';
import type { CompanyRow } from '../src/types';

const companyRepository = {
  findAll: async () => [] as CompanyRow[],
  findById: async () => null as CompanyRow | null,
  update: async () => true,
  create: async () => 1,
};

const userRepository = {
  countByCompany: async () => 0,
};

const subscriptionService = new SubscriptionService(
  companyRepository as unknown as CompanyRepository,
  userRepository as unknown as UserRepository,
);

const makeCompany = (overrides: Partial<CompanyRow & { plan_key?: string; plan_status?: string; plan_expires_at?: Date | string | null; billing_email?: string | null }> = {}): CompanyRow & { plan_key: string; plan_status: string; plan_expires_at: Date | string | null; billing_email: string | null } => ({
  id: 1,
  name: 'KneaChat',
  domain: 'kneachat.com',
  logo: null,
  created_at: '2026-08-17T10:00:00Z',
  updated_at: '2026-08-17T10:00:00Z',
  user_count: 7,
  active_user_count: 7,
  admin_count: 1,
  team_count: 2,
  channel_count: 4,
  plan_key: 'enterprise',
  plan_status: 'active',
  plan_expires_at: null,
  billing_email: null,
  ...overrides,
});

describe('SubscriptionService.getPlans', () => {
  it('exposes the three product tiers', () => {
    const plans = subscriptionService.getPlans();
    assert.deepEqual(plans.map((p) => p.key), ['free', 'pro', 'enterprise']);
    assert.equal(plans[0].seatLimit, 10);
    assert.equal(plans[2].seatLimit, 0); // unlimited
  });
});

describe('SubscriptionService.getCompanySubscription', () => {
  it('reports usage against the company plan', async (t) => {
    t.mock.method(companyRepository, 'findById', async () => makeCompany({ plan_key: 'free', user_count: 5 }));
    const subscription = await subscriptionService.getCompanySubscription(1);
    assert.equal(subscription.plan.key, 'free');
    assert.equal(subscription.user_count, 5);
    assert.equal(subscription.seats_remaining, 5);
    assert.equal(subscription.at_seat_limit, false);
  });

  it('flags a workspace that reached the seat limit', async (t) => {
    t.mock.method(companyRepository, 'findById', async () => makeCompany({ plan_key: 'free', user_count: 10 }));
    const subscription = await subscriptionService.getCompanySubscription(1);
    assert.equal(subscription.at_seat_limit, true);
    assert.equal(subscription.seats_remaining, 0);
  });

  it('treats Enterprise as unlimited', async (t) => {
    t.mock.method(companyRepository, 'findById', async () => makeCompany({ plan_key: 'enterprise', user_count: 500 }));
    const subscription = await subscriptionService.getCompanySubscription(1);
    assert.equal(subscription.seats_remaining, -1);
    assert.equal(subscription.at_seat_limit, false);
  });
});

describe('SubscriptionService.assertCanAddUser', () => {
  it('passes when the workspace is under its seat limit', async (t) => {
    t.mock.method(companyRepository, 'findById', async () => makeCompany({ plan_key: 'free', user_count: 3 }));
    await subscriptionService.assertCanAddUser(1); // resolves
  });

  it('throws at the seat limit', async (t) => {
    t.mock.method(companyRepository, 'findById', async () => makeCompany({ plan_key: 'pro', user_count: 50 }));
    await assert.rejects(
      subscriptionService.assertCanAddUser(1),
      /reached the Pro plan limit of 50 users/,
    );
  });

  it('never blocks unlimited plans', async (t) => {
    t.mock.method(companyRepository, 'findById', async () => makeCompany({ plan_key: 'enterprise', user_count: 999 }));
    await subscriptionService.assertCanAddUser(1); // resolves
  });

  it('blocks new users when the subscription is canceled', async (t) => {
    t.mock.method(companyRepository, 'findById', async () =>
      makeCompany({ plan_key: 'free', user_count: 2, plan_status: 'canceled' }));
    await assert.rejects(
      subscriptionService.assertCanAddUser(1),
      /subscription has been canceled/,
    );
  });
});

describe('SubscriptionService.setCompanyPlan', () => {
  it('changes the plan and returns refreshed usage', async (t) => {
    t.mock.method(companyRepository, 'findById', async () => makeCompany({ plan_key: 'free', user_count: 6 }));
    const update = t.mock.method(companyRepository, 'update', async () => true);
    t.mock.method(companyRepository, 'findById', async () => makeCompany({ plan_key: 'pro', user_count: 6 }));

    const subscription = await subscriptionService.setCompanyPlan(1, { plan_key: 'pro' });

    assert.deepEqual(update.mock.calls[0].arguments, [1, { plan_key: 'pro' }]);
    assert.equal(subscription.plan_key, 'pro');
    assert.equal(subscription.plan.seatLimit, 50);
  });

  it('rejects an unknown plan key', async (t) => {
    t.mock.method(companyRepository, 'findById', async () => makeCompany());
    await assert.rejects(
      subscriptionService.setCompanyPlan(1, { plan_key: 'mega' }),
      /Unknown plan "mega"/,
    );
  });

  it('rejects an unknown plan status', async (t) => {
    t.mock.method(companyRepository, 'findById', async () => makeCompany());
    await assert.rejects(
      subscriptionService.setCompanyPlan(1, { plan_status: 'suspended' }),
      /Unknown plan status "suspended"/,
    );
  });
});
