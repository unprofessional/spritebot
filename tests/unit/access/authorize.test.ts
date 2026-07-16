const mockIsGifted = jest.fn();
const mockGetEntitlementsFor = jest.fn();

jest.mock('../../../src/dao/gifted_guilds.dao', () => ({
  GiftedGuildsDAO: jest.fn().mockImplementation(() => ({
    isGifted: mockIsGifted,
  })),
}));

jest.mock('../../../src/services/entitlements.service', () => ({
  getEntitlementsFor: mockGetEntitlementsFor,
}));

import { authorizeInteraction } from '../../../src/access/authorize';

describe('authorizeInteraction gifted access ordering', () => {
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    mockIsGifted.mockReset();
    mockGetEntitlementsFor.mockReset();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('authorizes a gifted guild without resolving Discord entitlements', async () => {
    mockIsGifted.mockResolvedValue(true);

    await expect(
      authorizeInteraction({
        feature: 'rpg:characters',
        guildId: 'guild-1',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ ok: true, planName: 'Gifted' });

    expect(mockIsGifted).toHaveBeenCalledWith('guild-1');
    expect(mockGetEntitlementsFor).not.toHaveBeenCalled();
  });

  test('preserves paid access for a non-gifted guild', async () => {
    mockIsGifted.mockResolvedValue(false);
    mockGetEntitlementsFor.mockResolvedValue({
      status: 'active',
      planName: 'Discord Plan',
      features: new Set(['core', 'rpg:characters']),
    });

    await expect(
      authorizeInteraction({
        feature: 'rpg:characters',
        guildId: 'guild-2',
        userId: 'user-2',
      }),
    ).resolves.toEqual({ ok: true, planName: 'Discord Plan' });

    expect(mockGetEntitlementsFor).toHaveBeenCalledWith({ guildId: 'guild-2' });
  });

  test('preserves the existing premium denial for a non-gifted core-only guild', async () => {
    mockIsGifted.mockResolvedValue(false);
    mockGetEntitlementsFor.mockResolvedValue({
      status: 'active',
      planName: 'Core',
      features: new Set(['core']),
    });

    await expect(
      authorizeInteraction({
        feature: 'rpg:characters',
        guildId: 'guild-3',
        userId: 'user-3',
      }),
    ).resolves.toEqual({ ok: false, reason: 'NOT_INCLUDED' });
  });

  test('continues to entitlement resolution when the gifted lookup fails', async () => {
    mockIsGifted.mockRejectedValue(new Error('database unavailable'));
    mockGetEntitlementsFor.mockResolvedValue({
      status: 'active',
      planName: 'Discord Plan',
      features: new Set(['rpg:characters']),
    });

    await expect(
      authorizeInteraction({
        feature: 'rpg:characters',
        guildId: 'guild-4',
        userId: 'user-4',
      }),
    ).resolves.toEqual({ ok: true, planName: 'Discord Plan' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('guild=guild-4');
    expect(mockGetEntitlementsFor).toHaveBeenCalledWith({ guildId: 'guild-4' });
  });
});
