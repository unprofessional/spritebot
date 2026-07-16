const mockFindActiveByGuild = jest.fn();
const mockUpsertFromWebhook = jest.fn();
const mockFetchGuildEntitlementsLazy = jest.fn();

jest.mock('../../../src/dao/entitlements_cache.dao', () => ({
  EntitlementsCacheDAO: jest.fn().mockImplementation(() => ({
    findActiveByGuild: mockFindActiveByGuild,
    upsertFromWebhook: mockUpsertFromWebhook,
  })),
}));

jest.mock('../../../src/services/discord_entitlements_api', () => ({
  fetchGuildEntitlementsLazy: mockFetchGuildEntitlementsLazy,
}));

import { getEntitlementsFor } from '../../../src/services/entitlements.service';

describe('entitlement resolution availability semantics', () => {
  beforeEach(() => {
    mockFindActiveByGuild.mockReset();
    mockUpsertFromWebhook.mockReset();
    mockFetchGuildEntitlementsLazy.mockReset();
  });

  test('preserves trustworthy cached access without a remote request', async () => {
    mockFindActiveByGuild.mockResolvedValue([
      {
        entitlement_id: 'entitlement-1',
        guild_id: 'guild-1',
        sku_id: 'sku-1',
        status: 'active',
        starts_at: new Date(0),
        ends_at: null,
        updated_at: new Date(0),
        raw: {},
      },
    ]);

    await expect(getEntitlementsFor({ guildId: 'guild-1' })).resolves.toEqual(
      expect.objectContaining({ status: 'active', planName: 'Discord Plan' }),
    );
    expect(mockFetchGuildEntitlementsLazy).not.toHaveBeenCalled();
  });

  test('returns core only after Discord confirms an empty entitlement set', async () => {
    mockFindActiveByGuild.mockResolvedValue([]);
    mockFetchGuildEntitlementsLazy.mockResolvedValue({ ok: true, entitlements: [] });

    await expect(getEntitlementsFor({ guildId: 'guild-2' })).resolves.toEqual({
      status: 'active',
      planName: 'Core',
      features: new Set(['core']),
      expiresAt: null,
    });
  });

  test('preserves a remote failure as unavailable instead of granting core', async () => {
    mockFindActiveByGuild.mockResolvedValue([]);
    mockFetchGuildEntitlementsLazy.mockResolvedValue({
      ok: false,
      failure: {
        category: 'timeout',
        retryable: true,
        safeMessage: 'Discord operation timed out.',
      },
    });

    await expect(getEntitlementsFor({ guildId: 'guild-3' })).resolves.toEqual({
      status: 'unavailable',
      failure: expect.objectContaining({ category: 'timeout' }),
    });
    expect(mockUpsertFromWebhook).not.toHaveBeenCalled();
  });
});
