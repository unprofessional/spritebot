import { bestEffortInteractionResponse } from '../../../src/client/interaction_responses';

describe('bestEffortInteractionResponse', () => {
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('replies to a fresh repliable interaction', async () => {
    const payload = { content: 'fallback', ephemeral: true } as const;
    const interaction = {
      type: 2,
      isRepliable: () => true,
      replied: false,
      deferred: false,
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn(),
    };

    await bestEffortInteractionResponse(interaction as never, payload, 'test');

    expect(interaction.reply).toHaveBeenCalledWith(payload);
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  test.each([
    { replied: true, deferred: false },
    { replied: false, deferred: true },
  ])('follows up after an interaction was acknowledged: %o', async ({ replied, deferred }) => {
    const payload = { content: 'fallback', ephemeral: true } as const;
    const interaction = {
      type: 2,
      isRepliable: () => true,
      replied,
      deferred,
      reply: jest.fn(),
      followUp: jest.fn().mockResolvedValue(undefined),
    };

    await bestEffortInteractionResponse(interaction as never, payload, 'test');

    expect(interaction.followUp).toHaveBeenCalledWith(payload);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test('does nothing for a non-repliable interaction', async () => {
    const interaction = {
      type: 3,
      isRepliable: () => false,
      reply: jest.fn(),
      followUp: jest.fn(),
    };

    await bestEffortInteractionResponse(interaction as never, { content: 'fallback' }, 'test');

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  test('contains an expired interaction reply failure and logs redacted metadata', async () => {
    const expired = Object.assign(new Error('Unknown interaction'), {
      code: 10062,
      status: 404,
      url: 'https://discord.com/api/interactions/id/secret-token/callback',
    });
    const interaction = {
      type: 2,
      isRepliable: () => true,
      replied: false,
      deferred: false,
      reply: jest.fn().mockRejectedValue(expired),
      followUp: jest.fn(),
      token: 'secret-token',
    };

    await expect(
      bestEffortInteractionResponse(
        interaction as never,
        { content: 'fallback', ephemeral: true },
        'error-fallback',
      ),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warning = String(warnSpy.mock.calls[0][0]);
    expect(warning).toContain('context=error-fallback');
    expect(warning).toContain('operation=reply');
    expect(warning).toContain('type=2');
    expect(warning).toContain('code=10062');
    expect(warning).toContain('status=404');
    expect(warning).not.toContain('secret-token');
    expect(warning).not.toContain('/callback');
  });

  test('contains a follow-up failure with absent error metadata', async () => {
    const interaction = {
      type: 5,
      isRepliable: () => true,
      replied: true,
      deferred: false,
      reply: jest.fn(),
      followUp: jest.fn().mockRejectedValue('network failure'),
    };

    await expect(
      bestEffortInteractionResponse(interaction as never, { content: 'fallback' }, 'test'),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('operation=followUp type=5 code=unknown status=unknown'),
    );
  });
});
