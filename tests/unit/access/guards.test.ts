const mockAuthorizeInteraction = jest.fn();

jest.mock('../../../src/access/authorize', () => ({
  authorizeInteraction: mockAuthorizeInteraction,
}));

import {
  AUTHORIZATION_UNAVAILABLE_MSG,
  guardCommand,
  guardComponent,
  UPGRADE_MSG,
} from '../../../src/access/guards';

describe('authorization guard failure copy', () => {
  beforeEach(() => {
    mockAuthorizeInteraction.mockReset();
  });

  test('returns retry-later copy for an unavailable entitlement check', async () => {
    mockAuthorizeInteraction.mockResolvedValue({
      ok: false,
      reason: 'AUTHORIZATION_UNAVAILABLE',
    });

    const result = await guardCommand(commandInteraction());

    expect(result).toBe(
      'I couldn’t verify this server’s access with Discord right now. Nothing was changed. Please try again in a moment.',
    );
    expect(result).toBe(AUTHORIZATION_UNAVAILABLE_MSG);
    expect(result).not.toBe(UPGRADE_MSG);
  });

  test('preserves the upgrade copy for a confirmed feature denial', async () => {
    mockAuthorizeInteraction.mockResolvedValue({ ok: false, reason: 'NOT_INCLUDED' });

    await expect(guardCommand(commandInteraction())).resolves.toBe(UPGRADE_MSG);
  });

  test('allows explicitly public commands without a guild or entitlement lookup', async () => {
    await expect(
      guardCommand({ commandName: 'support', user: { id: 'user-1' }, guild: null } as never),
    ).resolves.toBe(true);
    expect(mockAuthorizeInteraction).not.toHaveBeenCalled();
  });

  test('allows explicitly public components without an entitlement lookup', async () => {
    await expect(
      guardComponent({
        customId: 'supportVerify:verify',
        user: { id: 'user-1' },
        guild: null,
      } as never),
    ).resolves.toBe(true);
    expect(mockAuthorizeInteraction).not.toHaveBeenCalled();
  });
});

function commandInteraction() {
  return {
    commandName: 'create-character',
    user: { id: 'user-1' },
    guild: { id: 'guild-1', members: { me: null } },
  } as never;
}
