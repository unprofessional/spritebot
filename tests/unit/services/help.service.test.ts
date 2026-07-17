import type { FeatureKey } from '../../../src/access/features';
import { GiftedGuildsDAO } from '../../../src/dao/gifted_guilds.dao';

const getEntitlementsFor = jest.fn();
jest.mock('../../../src/services/entitlements.service', () => ({ getEntitlementsFor }));

import { getHelpFeatures } from '../../../src/services/help.service';

describe('help feature resolution', () => {
  const giftedSpy = jest.spyOn(GiftedGuildsDAO.prototype, 'isGifted');

  beforeEach(() => {
    giftedSpy.mockReset().mockResolvedValue(false);
    getEntitlementsFor.mockReset();
  });

  afterAll(() => {
    giftedSpy.mockRestore();
  });

  test('uses the guild entitlement feature set', async () => {
    const features = new Set<FeatureKey>(['core', 'rpg:characters']);
    getEntitlementsFor.mockResolvedValue({ status: 'active', features });

    await expect(getHelpFeatures('guild-1')).resolves.toEqual({ ok: true, features });
    expect(getEntitlementsFor).toHaveBeenCalledWith({ guildId: 'guild-1' });
  });

  test('gives gifted guilds the same full feature visibility as authorization', async () => {
    giftedSpy.mockResolvedValue(true);

    const result = await getHelpFeatures('guild-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.features).toEqual(
        new Set<FeatureKey>([
          'core',
          'rpg:characters',
          'rpg:inventory',
          'rpg:game-admin',
          'automation:thread-bump',
          'pro:transcription',
        ]),
      );
    }
    expect(getEntitlementsFor).not.toHaveBeenCalled();
  });

  test('reports unavailable entitlement resolution', async () => {
    getEntitlementsFor.mockResolvedValue({
      status: 'unavailable',
      failure: { category: 'transient' },
    });

    await expect(getHelpFeatures('guild-1')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});
