import { ApplicationCommandOptionType, ChannelType, PermissionFlagsBits } from 'discord.js';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../../../src/discord/interaction_dispatch';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';

type RemainingCommand = {
  data?: { toJSON(): unknown };
  autocomplete?(interaction: unknown): Promise<Array<{ name: string; value: string }>>;
  interactionPolicy: InteractionDispatchPolicy;
  execute(interaction: unknown, context: InteractionCommandContext): Promise<unknown>;
};

const bumpThreadCommand = require('../../../src/commands/bump-thread') as RemainingCommand;
const transcribeCommand = require('../../../src/commands/transcribe') as RemainingCommand;
const verifyGreetingCommand = require('../../../src/commands/verify-greeting') as RemainingCommand;

const commands: Array<[string, RemainingCommand]> = [
  ['transcribe', transcribeCommand],
  ['bump-thread', bumpThreadCommand],
  ['verify-greeting', verifyGreetingCommand],
];

describe('remaining command responder migration', () => {
  test.each(commands)('/%s declares an ephemeral auto-defer policy', (_name, command) => {
    expect(command.interactionPolicy).toEqual({
      mode: { kind: 'reply', visibility: 'ephemeral' },
      acknowledgement: 'auto-defer',
    });
  });

  test('/transcribe preserves its server-only rejection after deferral', async () => {
    const interaction = commandInteraction({ guildId: null });

    await executePreDeferred(transcribeCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '⚠️ This command must be used in a server.',
    });
  });

  test('/transcribe start uses the existing dispatcher deferral', async () => {
    const interaction = commandInteraction({ userId: '818606180095885332' });
    interaction.options.getSubcommand.mockReturnValue('start');
    interaction.options.getString.mockReturnValue('not-a-channel');

    await executePreDeferred(transcribeCommand, interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '⚠️ Choose the voice and text channels from the suggestions.',
    });
  });

  test('/transcribe reloads selected ids and rejects stale channels at execution time', async () => {
    const interaction = commandInteraction({ userId: '818606180095885332' });
    const fetchChannel = jest.fn().mockResolvedValue(null);
    interaction.guild = {
      id: 'guild-1',
      channels: { fetch: fetchChannel },
      members: { fetch: jest.fn().mockResolvedValue({ id: '818606180095885332' }) },
    };
    interaction.options.getSubcommand.mockReturnValue('start');
    interaction.options.getString.mockImplementation((name: string) =>
      name === 'voice-channel' ? '11111111111111111' : '22222222222222222',
    );

    await executePreDeferred(transcribeCommand, interaction);

    expect(fetchChannel).toHaveBeenCalledWith('11111111111111111');
    expect(fetchChannel).toHaveBeenCalledWith('22222222222222222');
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '⚠️ Choose a voice channel I can join.',
    });
  });

  test('/transcribe rejects stale cached private-thread membership at execution time', async () => {
    const interaction = commandInteraction({ userId: '818606180095885332' });
    const member = { id: '818606180095885332' };
    const voiceChannel = {
      id: '11111111111111111',
      type: ChannelType.GuildVoice,
      joinable: true,
      permissionsFor: jest.fn().mockReturnValue({ has: jest.fn().mockReturnValue(true) }),
    };
    const fetchThreadMember = jest.fn().mockRejectedValue(new Error('Unknown Member'));
    const privateThread = {
      id: '22222222222222222',
      type: ChannelType.PrivateThread,
      members: { cache: new Map([[member.id, {}]]), fetch: fetchThreadMember },
      permissionsFor: jest.fn().mockReturnValue({
        has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.ViewChannel),
      }),
    };
    interaction.guild = {
      id: 'guild-1',
      channels: {
        fetch: jest.fn((id: string) =>
          Promise.resolve(id === voiceChannel.id ? voiceChannel : privateThread),
        ),
      },
      members: { fetch: jest.fn().mockResolvedValue(member) },
    };
    interaction.options.getSubcommand.mockReturnValue('start');
    interaction.options.getString.mockImplementation((name: string) =>
      name === 'voice-channel' ? voiceChannel.id : privateThread.id,
    );

    await executePreDeferred(transcribeCommand, interaction);

    expect(fetchThreadMember).toHaveBeenCalledWith({ member: member.id, force: true });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '⚠️ Choose a text channel for transcript output.',
    });
  });

  test('/transcribe registers bot-owned channel autocomplete options', () => {
    const command = transcribeCommand.data?.toJSON() as {
      options: Array<{
        name: string;
        options: Array<{ name: string; type: number; autocomplete?: boolean }>;
      }>;
    };
    const start = command.options.find((option) => option.name === 'start');

    expect(start?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'voice-channel',
          type: ApplicationCommandOptionType.String,
          autocomplete: true,
        }),
        expect.objectContaining({
          name: 'text-channel',
          type: ApplicationCommandOptionType.String,
          autocomplete: true,
        }),
      ]),
    );
  });

  test('/transcribe autocomplete returns only visible channels of the focused kind', async () => {
    const visible = { has: jest.fn().mockReturnValue(true) };
    const hidden = { has: jest.fn().mockReturnValue(false) };
    const member = { id: 'user-1' };
    const channel = (id: string, name: string, type: ChannelType, permissions = visible) => ({
      id,
      name,
      type,
      parent: null,
      permissionsFor: jest.fn().mockReturnValue(permissions),
    });
    const interaction = {
      guild: {
        members: {
          cache: new Map([['user-1', member]]),
          fetch: jest.fn(),
        },
        channels: {
          cache: new Map([
            [
              '11111111111111111',
              channel('11111111111111111', 'crisis_response', ChannelType.GuildVoice),
            ],
            [
              '22222222222222222',
              channel('22222222222222222', 'crisis_chat', ChannelType.GuildText),
            ],
            [
              '33333333333333333',
              channel('33333333333333333', 'hidden_voice', ChannelType.GuildVoice, hidden),
            ],
          ]),
        },
      },
      user: { id: 'user-1' },
      options: {
        getFocused: jest.fn().mockReturnValue({ name: 'voice-channel', value: 'crisis' }),
      },
    };

    await expect(transcribeCommand.autocomplete?.(interaction)).resolves.toEqual([
      { name: 'crisis_response — Voice', value: '11111111111111111' },
    ]);
  });

  test('/transcribe autocomplete hides private threads from non-members without fetching', async () => {
    const member = { id: 'user-1' };
    const permissions = {
      has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.ViewChannel),
    };
    const thread = (id: string, memberIds: string[]) => ({
      id,
      name: 'gm-notes',
      type: ChannelType.PrivateThread,
      parent: { name: 'Operations' },
      members: { cache: new Map(memberIds.map((memberId) => [memberId, {}])) },
      permissionsFor: jest.fn().mockReturnValue(permissions),
    });
    const fetchMember = jest.fn();
    const interaction = {
      guild: {
        members: {
          cache: new Map([['user-1', member]]),
          fetch: fetchMember,
        },
        channels: {
          cache: new Map([
            ['44444444444444444', thread('44444444444444444', [])],
            ['55555555555555555', thread('55555555555555555', ['user-1'])],
          ]),
        },
      },
      user: { id: 'user-1' },
      options: {
        getFocused: jest.fn().mockReturnValue({ name: 'text-channel', value: 'notes' }),
      },
    };

    await expect(transcribeCommand.autocomplete?.(interaction)).resolves.toEqual([
      { name: 'gm-notes — Text • Operations', value: '55555555555555555' },
    ]);
    expect(fetchMember).not.toHaveBeenCalled();
  });

  test('/bump-thread preserves its permission rejection after deferral', async () => {
    const interaction = commandInteraction();

    await executePreDeferred(bumpThreadCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '❌ You need **Manage Threads** to do that.',
    });
  });

  test('/verify-greeting preserves its owner rejection after deferral', async () => {
    const interaction = commandInteraction({ userId: 'not-owner' });

    await executePreDeferred(verifyGreetingCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: '⛔ Not authorized.' });
  });

  test.each(commands)('stops /%s cleanly when its responder is expired', async (name, command) => {
    const interaction = commandInteraction({
      commandName: name,
      guildId: name === 'transcribe' ? null : 'guild-1',
      userId: 'not-owner',
    });
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
  command: RemainingCommand,
  interaction: ReturnType<typeof commandInteraction>,
): Promise<void> {
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
  commandName = 'remaining-command',
  guildId = 'guild-1',
  userId = 'user-1',
}: {
  commandName?: string;
  guildId?: string | null;
  userId?: string;
} = {}) {
  return {
    type: 2,
    commandName,
    guildId,
    guild: guildId ? { id: guildId } : null,
    channel: null,
    channelId: 'channel-1',
    memberPermissions: { has: jest.fn().mockReturnValue(false) },
    client: {
      channels: { fetch: jest.fn().mockResolvedValue(null) },
      guilds: { cache: new Map() },
    },
    options: {
      getSubcommand: jest.fn().mockReturnValue('status'),
      getChannel: jest.fn().mockReturnValue(null),
      getString: jest.fn().mockReturnValue(null),
      getInteger: jest.fn().mockReturnValue(null),
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
