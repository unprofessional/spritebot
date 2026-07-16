import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../../../src/discord/interaction_dispatch';
import { dispatchInteractionWithDeadline } from '../../../src/discord/interaction_dispatch';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';

type AdminCommand = {
  interactionPolicy: InteractionDispatchPolicy;
  execute(interaction: unknown, context: InteractionCommandContext): Promise<unknown>;
};

const adminCommand = require('../../../src/commands/admin') as AdminCommand;
const announcementsCommand = require('../../../src/commands/bot-announcements') as AdminCommand;

describe('admin command responder migration', () => {
  test('/admin preserves its server-only rejection after deferral', async () => {
    const interaction = commandInteraction({ guildId: null });

    await executePreDeferred(adminCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '⚠️ This command must be used in a server.',
    });
  });

  test('/admin preserves its owner rejection after deferral', async () => {
    const interaction = commandInteraction({ subcommand: 'global-stats', userId: 'not-owner' });

    await executePreDeferred(adminCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: '⛔ Not authorized.' });
  });

  test('/admin routes delegated handler responses through the dispatcher proxy', async () => {
    const interaction = commandInteraction({
      subcommand: 'global-stats',
      userId: process.env.OWNER_DISCORD_ID,
    });

    await dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: adminCommand.interactionPolicy,
      handler: (routedInteraction, responder) =>
        adminCommand.execute(routedInteraction, { responder }),
    });

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        ephemeral: true,
      }),
    );
  });

  test('/bot-announcements preserves its server-only rejection after deferral', async () => {
    const interaction = commandInteraction({ guildId: null });

    await executePreDeferred(announcementsCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '⚠️ This command must be used in a server.',
    });
  });

  test('/bot-announcements preserves cross-server channel feedback after deferral', async () => {
    const interaction = commandInteraction({
      channel: { id: 'channel-2', guildId: 'other-guild' },
      subcommand: 'set',
    });

    await executePreDeferred(announcementsCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'That channel must belong to this server.',
    });
  });

  test.each([
    ['admin', adminCommand],
    ['bot-announcements', announcementsCommand],
  ])('stops /%s cleanly when its responder is expired', async (_name, command) => {
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

async function executePreDeferred(
  command: AdminCommand,
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

function commandInteraction({
  channel = null,
  guildId = 'guild-1',
  subcommand = 'status',
  userId = 'user-1',
}: {
  channel?: { id: string; guildId: string } | null;
  guildId?: string | null;
  subcommand?: string;
  userId?: string;
} = {}) {
  return {
    type: 2,
    commandName: 'admin-command',
    guildId,
    guild: guildId ? { id: guildId } : null,
    client: { guilds: { cache: new Map() } },
    options: {
      getSubcommand: jest.fn().mockReturnValue(subcommand),
      getString: jest.fn().mockReturnValue(null),
      getChannel: jest.fn().mockReturnValue(channel),
    },
    user: { id: userId },
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
