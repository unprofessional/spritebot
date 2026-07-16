import { CharacterDAO } from '../../../src/dao/character.dao';
import { GameDAO } from '../../../src/dao/game.dao';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../../../src/discord/interaction_dispatch';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import {
  getOrCreatePlayer,
  setCurrentCharacter,
  setCurrentGame,
} from '../../../src/services/player.service';
import { isUserInCharacterForChannel } from '../../../src/services/rp_channel_mode.service';

type InventoryRpCommand = {
  interactionPolicy: InteractionDispatchPolicy;
  execute(interaction: unknown, context: InteractionCommandContext): Promise<unknown>;
};

const icCommand = require('../../../src/commands/ic') as InventoryRpCommand;
const icDeleteCommand = require('../../../src/commands/ic-delete') as InventoryRpCommand;
const icDeleteContextCommand =
  require('../../../src/commands/ic-delete-context') as InventoryRpCommand;
const inventoryCommand = require('../../../src/commands/inventory') as InventoryRpCommand;
const oocCommand = require('../../../src/commands/ooc') as InventoryRpCommand;

describe('non-modal inventory and RP command responder migration', () => {
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

  test('/inventory preserves its card embeds and components after deferral', async () => {
    await seedActiveCharacter();
    const interaction = commandInteraction();

    await executePreDeferred(inventoryCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      }),
    );
  });

  test('/inventory does not retry when its deferred Discord callback fails', async () => {
    await seedActiveCharacter();
    const interaction = commandInteraction();
    interaction.editReply.mockRejectedValue(new Error('socket closed'));

    await expect(executePreDeferred(inventoryCommand, interaction)).rejects.toThrow(
      'socket closed',
    );

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  test('/ic preserves its response and persists channel mode after deferral', async () => {
    const interaction = commandInteraction();

    await executePreDeferred(icCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('now in-character'),
    });
    await expect(isUserInCharacterForChannel('guild-1', 'channel-1', 'user-1')).resolves.toBe(true);
  });

  test('/ooc preserves its response and persists channel mode after deferral', async () => {
    const interaction = commandInteraction();

    await executePreDeferred(oocCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('now out-of-character'),
    });
    await expect(isUserInCharacterForChannel('guild-1', 'channel-1', 'user-1')).resolves.toBe(
      false,
    );
  });

  test('/ic-delete preserves its confirmation content and components after deferral', async () => {
    const interaction = commandInteraction();

    await executePreDeferred(icDeleteCommand, interaction);

    expectDeleteConfirmation(interaction, 'confirmIcDelete:channel-1:123456789012345678:user-1');
  });

  test('Delete IC Message preserves its confirmation content and components after deferral', async () => {
    const interaction = commandInteraction();

    await executePreDeferred(icDeleteContextCommand, interaction);

    expectDeleteConfirmation(interaction, 'confirmIcDelete:channel-1:proxy-1:user-1');
  });

  test.each([
    ['inventory', inventoryCommand],
    ['ic', icCommand],
    ['ooc', oocCommand],
    ['ic-delete', icDeleteCommand],
    ['Delete IC Message', icDeleteContextCommand],
  ])('stops %s cleanly when its responder is expired', async (_name, command) => {
    const interaction = commandInteraction({ guildId: null });
    const responder = new DiscordInteractionResponder(
      interaction as never,
      command.interactionPolicy.mode,
    );
    responder.expire();

    await expect(command.execute(interaction, { responder })).resolves.not.toThrow();

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
});

async function seedActiveCharacter(): Promise<void> {
  const game = await new GameDAO().create({
    name: 'Lanternfall',
    description: 'A cozy dungeon crawl',
    created_by: 'user-1',
    guild_id: 'guild-1',
  });
  const character = await new CharacterDAO().create({
    user_id: 'user-1',
    game_id: game.id,
    name: 'Mira Vale',
    bio: null,
    avatar_url: null,
  });
  await getOrCreatePlayer('user-1', 'guild-1');
  await setCurrentGame('user-1', 'guild-1', game.id);
  await setCurrentCharacter('user-1', 'guild-1', character.id);
}

async function executePreDeferred(
  command: InventoryRpCommand,
  interaction: ReturnType<typeof commandInteraction>,
): Promise<void> {
  expect(command.interactionPolicy).toEqual({
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  });
  const responder = new DiscordInteractionResponder(
    interaction as never,
    command.interactionPolicy.mode,
  );
  await responder.acknowledge();
  await command.execute(interaction, { responder });
}

function expectEphemeralDeferral(interaction: ReturnType<typeof commandInteraction>): void {
  expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
  expect(interaction.reply).not.toHaveBeenCalled();
  expect(interaction.followUp).not.toHaveBeenCalled();
}

function expectDeleteConfirmation(
  interaction: ReturnType<typeof commandInteraction>,
  customId: string,
): void {
  expectEphemeralDeferral(interaction);
  const payload = interaction.editReply.mock.calls[0][0];
  const row = payload.components[0].toJSON();
  expect(payload.content).toBe('Delete this proxied RP message?');
  expect(row.components[0]).toEqual(expect.objectContaining({ custom_id: customId }));
}

function commandInteraction({ guildId = 'guild-1' }: { guildId?: string | null } = {}) {
  return {
    type: 2,
    commandName: 'inventory-rp-command',
    channelId: 'channel-1',
    guildId,
    guild: guildId ? { id: guildId } : null,
    user: { id: 'user-1' },
    targetMessage: { channelId: 'channel-1', id: 'proxy-1' },
    options: {
      getString: jest.fn().mockReturnValue('123456789012345678'),
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
