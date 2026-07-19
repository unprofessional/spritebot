import { GameDAO } from '../../../src/dao/game.dao';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../../../src/discord/interaction_dispatch';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import { createCharacter } from '../../../src/services/character.service';
import { getOrCreatePlayer, setCurrentGame } from '../../../src/services/player.service';
import { setUserChannelInCharacterMode } from '../../../src/services/rp_channel_mode.service';

type CoreCommand = {
  interactionPolicy:
    | InteractionDispatchPolicy
    | ((interaction: unknown) => InteractionDispatchPolicy);
  execute(interaction: unknown, context: InteractionCommandContext): Promise<unknown>;
};

const listCharactersCommand = require('../../../src/commands/list-characters') as CoreCommand;
const listGamesCommand = require('../../../src/commands/list-games') as CoreCommand;
const viewCharacterCommand = require('../../../src/commands/view-character') as CoreCommand;
const viewGameCommand = require('../../../src/commands/view-game') as CoreCommand;
const rollCommand = require('../../../src/commands/roll') as CoreCommand;

describe('core command responder migration', () => {
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

  test('preserves /list-games content and edits its pre-deferred ephemeral reply', async () => {
    await seedCoreView();
    const interaction = commandInteraction();

    await executePreDeferred(listGamesCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringMatching(/Lanternfall.*Active/s),
    });
  });

  test('preserves /view-game content, embeds, and components after deferral', async () => {
    await seedCoreView();
    const interaction = commandInteraction();

    await executePreDeferred(viewGameCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Lanternfall'),
        embeds: expect.any(Array),
        components: expect.any(Array),
      }),
    );
  });

  test('preserves /list-characters content and components after deferral', async () => {
    await seedCoreView();
    const interaction = commandInteraction();

    await executePreDeferred(listCharactersCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Public Characters in Your Game'),
        components: expect.any(Array),
      }),
    );
    expect(JSON.stringify(interaction.editReply.mock.calls[0][0].components)).toContain(
      'Mira Vale',
    );
  });

  test('preserves /view-character content and card components after deferral', async () => {
    await seedCoreView();
    const interaction = commandInteraction();

    await executePreDeferred(viewCharacterCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '💬 Roleplay mode: **OUT OF CHARACTER** in this channel.',
        embeds: expect.any(Array),
        components: expect.any(Array),
      }),
    );
  });

  test('shows the effective in-character mode on /view-character', async () => {
    await seedCoreView();
    await setUserChannelInCharacterMode({
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      isIc: true,
    });
    const interaction = commandInteraction();

    await executePreDeferred(viewCharacterCommand, interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '🎭 Roleplay mode: **IN CHARACTER** in this channel.',
      }),
    );
  });

  test('selects public visibility for a valid /roll before deferral and preserves its result', async () => {
    await seedCoreView();
    const interaction = commandInteraction({ dice: '2d6' });

    await executePreDeferred(rollCommand, interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('**Mira Vale** rolled `2d6`'),
        allowedMentions: { parse: [] },
      }),
    );
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  test('selects ephemeral visibility for an invalid /roll before its immediate response', async () => {
    const interaction = commandInteraction({ dice: 'not dice' });
    const policy = resolvePolicy(rollCommand, interaction);
    const responder = new DiscordInteractionResponder(interaction as never, policy.mode);

    await rollCommand.execute(interaction, { responder });

    expect(policy.mode).toEqual({ kind: 'reply', visibility: 'ephemeral' });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Use a roll like `2d20`'),
      ephemeral: true,
    });
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  test.each([
    ['list-characters', listCharactersCommand],
    ['list-games', listGamesCommand],
    ['view-character', viewCharacterCommand],
    ['view-game', viewGameCommand],
    ['roll', rollCommand],
  ])('stops /%s cleanly when its responder is expired', async (_name, command) => {
    await seedCoreView();
    const interaction = commandInteraction();
    const policy = resolvePolicy(command, interaction);
    const responder = new DiscordInteractionResponder(interaction as never, policy.mode);
    responder.expire();

    await expect(command.execute(interaction, { responder })).resolves.not.toThrow();

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
});

async function seedCoreView(): Promise<void> {
  const game = await new GameDAO().create({
    name: 'Lanternfall',
    description: 'A cozy dungeon crawl',
    created_by: 'user-1',
    guild_id: 'guild-1',
  });
  await getOrCreatePlayer('user-1', 'guild-1');
  await setCurrentGame('user-1', 'guild-1', game.id);
  await createCharacter({
    userId: 'user-1',
    guildId: 'guild-1',
    gameId: game.id,
    name: 'Mira Vale',
    visibility: 'public',
  });
}

async function executePreDeferred(
  command: CoreCommand,
  interaction: ReturnType<typeof commandInteraction>,
) {
  const policy = resolvePolicy(command, interaction);
  const responder = new DiscordInteractionResponder(interaction as never, policy.mode);
  await responder.acknowledge();
  await command.execute(interaction, { responder });
}

function resolvePolicy(
  command: CoreCommand,
  interaction: ReturnType<typeof commandInteraction>,
): InteractionDispatchPolicy {
  return typeof command.interactionPolicy === 'function'
    ? command.interactionPolicy(interaction)
    : command.interactionPolicy;
}

function expectEphemeralDeferral(interaction: ReturnType<typeof commandInteraction>): void {
  expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
  expect(interaction.reply).not.toHaveBeenCalled();
  expect(interaction.followUp).not.toHaveBeenCalled();
}

function commandInteraction({ dice = '2d6' }: { dice?: string } = {}) {
  return {
    type: 2,
    commandName: 'core-command',
    guildId: 'guild-1',
    guild: { id: 'guild-1' },
    channelId: 'channel-1',
    channel: { isThread: () => false },
    member: { displayName: 'Server Sage' },
    user: {
      id: 'user-1',
      displayName: 'Account Sage',
      username: 'account_sage',
    },
    options: {
      getString: jest.fn((name: string) => (name === 'dice' ? dice : null)),
    },
    replied: false,
    deferred: false,
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    showModal: jest.fn().mockResolvedValue(undefined),
  };
}
