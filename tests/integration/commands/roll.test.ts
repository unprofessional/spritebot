const rollCommand = require('../../../src/commands/roll') as {
  execute(interaction: unknown, context: unknown): Promise<void>;
};

import { GameDAO } from '../../../src/dao/game.dao';
import { query } from '../../../src/db/client';
import { createCharacter } from '../../../src/services/character.service';
import * as d20RollService from '../../../src/services/d20_roll.service';
import { getOrCreatePlayer, setCurrentGame } from '../../../src/services/player.service';

function createInteraction({
  userId = 'user-1',
  guildId = 'guild-1',
  memberDisplayName = 'Server Sage',
  userDisplayName = 'Account Sage',
  username = 'account_sage',
  dice = '2d6',
}: {
  userId?: string;
  guildId?: string | null;
  memberDisplayName?: string | null;
  userDisplayName?: string;
  username?: string;
  dice?: string;
} = {}) {
  const reply = jest.fn().mockResolvedValue(undefined);
  const getString = jest.fn((name: string) => {
    if (name === 'dice') return dice;
    return null;
  });

  return {
    interaction: {
      id: `interaction-${userId}-${dice}`,
      guildId,
      channelId: 'channel-1',
      member: memberDisplayName === null ? null : { displayName: memberDisplayName },
      user: {
        id: userId,
        displayName: userDisplayName,
        username,
      },
      options: { getString },
      reply,
    },
    reply,
    responderContext: { responder: { respond: reply } },
  };
}

async function createActiveCharacter(name: string) {
  const game = await new GameDAO().create({
    name: 'Lanternfall',
    description: 'A cozy dungeon crawl',
    created_by: 'user-1',
    guild_id: 'guild-1',
  });

  await getOrCreatePlayer('user-1', 'guild-1');
  await setCurrentGame('user-1', 'guild-1', game.id);

  return createCharacter({
    userId: 'user-1',
    guildId: 'guild-1',
    gameId: game.id,
    name,
  });
}

describe('/roll', () => {
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test('prefers the active character name in a server', async () => {
    await createActiveCharacter('Mira Vale');
    const { interaction, reply, responderContext } = createInteraction();

    await rollCommand.execute(interaction, responderContext);

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('**Mira Vale** rolled `2d6`'),
        allowedMentions: { parse: [] },
      }),
    );
  });

  test('falls back to the server profile display name without an active character', async () => {
    const { interaction, reply, responderContext } = createInteraction({
      memberDisplayName: 'Table Captain',
    });

    await rollCommand.execute(interaction, responderContext);

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('**Table Captain** rolled `2d6`'),
        allowedMentions: { parse: [] },
      }),
    );
  });

  test('falls back to the account display name outside a server', async () => {
    const { interaction, reply, responderContext } = createInteraction({
      guildId: null,
      memberDisplayName: null,
      userDisplayName: 'Wandering Account',
    });

    await rollCommand.execute(interaction, responderContext);

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('**Wandering Account** rolled `2d6`'),
        allowedMentions: { parse: [] },
      }),
    );
  });

  test('accepts an uppercase dice expression', async () => {
    const { interaction, reply, responderContext } = createInteraction({ dice: '2D20' });

    await rollCommand.execute(interaction, responderContext);

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('**Server Sage** rolled `2d20`'),
        allowedMentions: { parse: [] },
      }),
    );
  });

  test('records only exact 1d20 rolls for distribution analysis', async () => {
    const d20 = createInteraction({ dice: '1D20' });
    await rollCommand.execute(d20.interaction, d20.responderContext);

    const otherRoll = createInteraction({ userId: 'user-2', dice: '2d20' });
    await rollCommand.execute(otherRoll.interaction, otherRoll.responderContext);

    const recorded = await query<{
      interaction_id: string;
      result: number;
      user_id: string;
      guild_id: string | null;
      channel_id: string;
    }>(
      `SELECT interaction_id, result, user_id, guild_id, channel_id
       FROM d20_roll
       WHERE interaction_id LIKE 'interaction-user-%'`,
    );

    expect(recorded.rows).toEqual([
      {
        interaction_id: 'interaction-user-1-1D20',
        result: expect.any(Number),
        user_id: 'user-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
      },
    ]);
    expect(recorded.rows[0].result).toBeGreaterThanOrEqual(1);
    expect(recorded.rows[0].result).toBeLessThanOrEqual(20);
  });

  test('still returns a 1d20 result when telemetry storage fails', async () => {
    const recordSpy = jest
      .spyOn(d20RollService, 'recordD20Roll')
      .mockRejectedValueOnce(new Error('database unavailable'));
    const { interaction, reply, responderContext } = createInteraction({ dice: '1d20' });

    await rollCommand.execute(interaction, responderContext);

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('rolled `1d20`'),
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[roll] Failed to record 1d20 telemetry:',
      expect.any(Error),
    );
    recordSpy.mockRestore();
  });

  test('explains unsupported dice expressions', async () => {
    const { interaction, reply, responderContext } = createInteraction({
      dice: '2 dice 20 sides',
    });

    await rollCommand.execute(interaction, responderContext);

    expect(reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Use a roll like `2d20`'),
      ephemeral: true,
    });
  });
});
