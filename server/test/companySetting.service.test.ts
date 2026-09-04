'use strict';

/**
 * CompanySettingService — per-company settings (Company Admin console).
 *   - getSettings merges stored rows with typed defaults
 *   - updateSettings validates keys/types/ranges before persisting
 *   - updateProfile edits workspace branding on the companies row
 *   - effectiveFeaturePolicy ANDs company settings with the platform policy
 *     (feature toggles), caps upload size, and takes the stricter password
 *     minimum
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CompanySettingService } from '../src/services/CompanySetting.service';
import type { CompanySettingRepository } from '../src/repositories/companySettingRepository';
import type { CompanyRepository } from '../src/repositories/companyRepository';
import type { CompanyRow } from '../src/types';

const companySettingRepository = {
  getByCompany: async () => [] as Array<{ company_id: number; setting_key: string; setting_value: string; updated_at: string }>,
  setMany: async (_companyId: number, _entries: Array<{ key: string; value: string }>) => undefined,
};

const companyRepository = {
  findById: async () => null as CompanyRow | null,
  update: async () => true,
};

const companySettingService = new CompanySettingService(
  companySettingRepository as unknown as CompanySettingRepository,
  companyRepository as unknown as CompanyRepository,
);

const makeCompany = (overrides: Partial<CompanyRow> = {}): CompanyRow => ({
  id: 1,
  name: 'KneaChat',
  domain: 'kneachat.com',
  logo: null,
  created_at: '2026-08-17T10:00:00Z',
  updated_at: '2026-08-17T10:00:00Z',
  ...overrides,
});

const platform = {
  allow_uploads: true,
  allow_reactions: true,
  allow_pinning: true,
  max_upload_size_mb: 10,
  password_min_length: 6,
};

describe('CompanySettingService.getSettings', () => {
  it('returns typed defaults when nothing is stored', async (t) => {
    t.mock.method(companySettingRepository, 'getByCompany', async () => []);
    const settings = await companySettingService.getSettings(1);
    assert.deepEqual(settings, {
      allow_uploads: true,
      allow_reactions: true,
      allow_pinning: true,
      max_upload_size_mb: 10,
      password_min_length: 6,
    });
  });

  it('merges stored values over the defaults', async (t) => {
    t.mock.method(companySettingRepository, 'getByCompany', async () => [
      { company_id: 1, setting_key: 'allow_pinning', setting_value: '0', updated_at: '2026-09-01T10:00:00Z' },
      { company_id: 1, setting_key: 'password_min_length', setting_value: '12', updated_at: '2026-09-01T10:00:00Z' },
    ]);
    const settings = await companySettingService.getSettings(1);
    assert.equal(settings.allow_pinning, false);
    assert.equal(settings.password_min_length, 12);
    assert.equal(settings.allow_uploads, true);
  });
});

describe('CompanySettingService.updateSettings', () => {
  it('rejects an unknown setting key', async (t) => {
    const setMany = t.mock.method(companySettingRepository, 'setMany', async () => undefined);
    await assert.rejects(
      companySettingService.updateSettings(1, { made_up_key: true }),
      /Unknown company setting "made_up_key"/,
    );
    assert.equal(setMany.mock.calls.length, 0);
  });

  it('requires booleans to actually be booleans', async (t) => {
    t.mock.method(companySettingRepository, 'setMany', async () => undefined);
    await assert.rejects(
      companySettingService.updateSettings(1, { allow_uploads: 'yes' }),
      /Setting "allow_uploads" must be a boolean/,
    );
  });

  it('persists serialized values for valid keys', async (t) => {
    t.mock.method(companySettingRepository, 'getByCompany', async () => [
      { company_id: 1, setting_key: 'allow_reactions', setting_value: '0', updated_at: '2026-09-01T10:00:00Z' },
      { company_id: 1, setting_key: 'password_min_length', setting_value: '9', updated_at: '2026-09-01T10:00:00Z' },
    ]);
    const setMany = t.mock.method(companySettingRepository, 'setMany', async () => undefined);

    const settings = await companySettingService.updateSettings(1, {
      allow_reactions: false,
      password_min_length: 9,
    });

    const entries = setMany.mock.calls[0].arguments[1];
    assert.deepEqual(entries, [
      { key: 'allow_reactions', value: '0' },
      { key: 'password_min_length', value: '9' },
    ]);
    assert.equal(settings.allow_reactions, false);
    assert.equal(settings.password_min_length, 9);
  });

  it('enforces numeric ranges', async (t) => {
    t.mock.method(companySettingRepository, 'setMany', async () => undefined);
    await assert.rejects(
      companySettingService.updateSettings(1, { max_upload_size_mb: 9999 }),
      /must be between 1 and 100/,
    );
  });
});

describe('CompanySettingService.updateProfile', () => {
  it('updates the workspace name/logo on the company row', async (t) => {
    t.mock.method(companyRepository, 'findById', async () => makeCompany());
    const update = t.mock.method(companyRepository, 'update', async () => true);
    t.mock.method(companyRepository, 'findById', async () => makeCompany({ name: 'Acme Inc.' }));

    const company = await companySettingService.updateProfile(1, { name: '  Acme Inc.  ', logo: '/uploads/logo.png' });

    assert.deepEqual(update.mock.calls[0].arguments, [1, { name: 'Acme Inc.', logo: '/uploads/logo.png' }]);
    assert.equal(company.name, 'Acme Inc.');
  });

  it('rejects an empty name', async (t) => {
    t.mock.method(companyRepository, 'findById', async () => makeCompany());
    const update = t.mock.method(companyRepository, 'update', async () => true);
    await assert.rejects(
      companySettingService.updateProfile(1, { name: '   ' }),
      /Workspace name is required/,
    );
    assert.equal(update.mock.calls.length, 0);
  });
});

describe('CompanySettingService.effectiveFeaturePolicy', () => {
  it('follows the platform policy when the company has no overrides', async (t) => {
    t.mock.method(companySettingRepository, 'getByCompany', async () => []);
    const policy = await companySettingService.effectiveFeaturePolicy(1, platform);
    assert.equal(policy.allow_uploads, true);
    assert.equal(policy.max_upload_size_mb, 10);
    assert.equal(policy.password_min_length, 6);
  });

  it('turns a feature off for a company even when the platform allows it', async (t) => {
    t.mock.method(companySettingRepository, 'getByCompany', async () => [
      { company_id: 1, setting_key: 'allow_reactions', setting_value: '0', updated_at: '2026-09-01T10:00:00Z' },
      { company_id: 1, setting_key: 'allow_pinning', setting_value: '0', updated_at: '2026-09-01T10:00:00Z' },
    ]);
    const policy = await companySettingService.effectiveFeaturePolicy(1, platform);
    assert.equal(policy.allow_reactions, false);
    assert.equal(policy.allow_pinning, false);
    assert.equal(policy.allow_uploads, true);
  });

  it('caps the upload size at the smaller of platform / company limits', async (t) => {
    t.mock.method(companySettingRepository, 'getByCompany', async () => [
      { company_id: 1, setting_key: 'max_upload_size_mb', setting_value: '2', updated_at: '2026-09-01T10:00:00Z' },
    ]);
    const policy = await companySettingService.effectiveFeaturePolicy(1, platform);
    assert.equal(policy.max_upload_size_mb, 2);
  });

  it('takes the stricter password minimum', async (t) => {
    t.mock.method(companySettingRepository, 'getByCompany', async () => [
      { company_id: 1, setting_key: 'password_min_length', setting_value: '14', updated_at: '2026-09-01T10:00:00Z' },
    ]);
    const policy = await companySettingService.effectiveFeaturePolicy(1, platform);
    assert.equal(policy.password_min_length, 14);
  });

  it('cannot re-enable a feature the platform disabled', async (t) => {
    t.mock.method(companySettingRepository, 'getByCompany', async () => [
      { company_id: 1, setting_key: 'allow_uploads', setting_value: '1', updated_at: '2026-09-01T10:00:00Z' },
    ]);
    const policy = await companySettingService.effectiveFeaturePolicy(1, { ...platform, allow_uploads: false });
    assert.equal(policy.allow_uploads, false);
  });
});
