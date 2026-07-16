const createGameCommand = require('../../../src/commands/create-game') as {
  execute(interaction: unknown): Promise<void>;
};
const listGamesCommand = require('../../../src/commands/list-games') as {
  execute(interaction: unknown, context: unknown): Promise<void>;
};
const viewGameCommand = require('../../../src/commands/view-game') as {
  execute(interaction: unknown, context: unknown): Promise<void>;
};
const icCommand = require('../../../src/commands/ic') as {
  execute(interaction: unknown): Promise<void>;
};
const oocCommand = require('../../../src/commands/ooc') as {
  execute(interaction: unknown): Promise<void>;
};

import { isUserInCharacterForChannel } from '../../../src/services/rp_channel_mode.service';

interface InteractionOptions {
  userId?: string;
  guildId?: string | null;
  channelId?: string;
  strings?: Record<string, string | null>;
}

function createInteraction({
  userId = 'user-1',
  guildId = 'guild-1',
  channelId = 'channel-1',
  strings = {},
}: InteractionOptions = {}) {
  const reply = jest.fn().mockResolvedValue(undefined);
  const getString = jest.fn((name: string) => strings[name] ?? null);

  return {
    interaction: {
      channelId,
      guildId,
      guild: guildId ? { id: guildId } : null,
      user: { id: userId },
      options: { getString },
      reply,
    },
    reply,
    responderContext: { responder: { respond: reply } },
  };
}

describe('app command flows', () => {
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('/create-game creates the active game that /list-games and /view-game can read', async () => {
    const created = createInteraction({
      strings: {
        name: 'Lanternfall',
        description: 'A cozy dungeon crawl',
      },
    });

    await createGameCommand.execute(created.interaction);

    const listed = createInteraction();
    await listGamesCommand.execute(listed.interaction, listed.responderContext);

    expect(listed.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Lanternfall'),
        ephemeral: true,
      }),
    );
    expect(listed.reply.mock.calls[0][0].content).toEqual(expect.stringContaining('Active'));

    const viewed = createInteraction();
    await viewGameCommand.execute(viewed.interaction, viewed.responderContext);

    expect(viewed.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Lanternfall'),
        embeds: expect.any(Array),
        components: expect.any(Array),
        ephemeral: true,
      }),
    );
  });

  test('/ic and /ooc persist the user channel roleplay mode', async () => {
    const ic = createInteraction({ userId: 'user-2', guildId: 'guild-2', channelId: 'channel-2' });

    await icCommand.execute(ic.interaction);

    await expect(isUserInCharacterForChannel('guild-2', 'channel-2', 'user-2')).resolves.toBe(true);
    expect(ic.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('in-character'),
        ephemeral: true,
      }),
    );

    const ooc = createInteraction({ userId: 'user-2', guildId: 'guild-2', channelId: 'channel-2' });

    await oocCommand.execute(ooc.interaction);

    await expect(isUserInCharacterForChannel('guild-2', 'channel-2', 'user-2')).resolves.toBe(
      false,
    );
    expect(ooc.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('out-of-character'),
        ephemeral: true,
      }),
    );
  });
});
