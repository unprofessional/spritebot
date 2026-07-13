jest.mock('../../../src/services/support_verification.service', () => ({
  hasSupportVerificationMatch: jest.fn((result) =>
    Boolean(result.subscriberGuildIds.length || result.playerGuilds.length),
  ),
  verifySupportMember: jest.fn(),
}));

import { verifySupportMember } from '../../../src/services/support_verification.service';

const verifySupportMemberMock = verifySupportMember as jest.MockedFunction<
  typeof verifySupportMember
>;

describe('support server commands', () => {
  const originalOwnerId = process.env.OWNER_DISCORD_ID;
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OWNER_DISCORD_ID = 'owner-1';
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalOwnerId == null) delete process.env.OWNER_DISCORD_ID;
    else process.env.OWNER_DISCORD_ID = originalOwnerId;
    errorSpy.mockRestore();
  });

  test('/support returns the support server invite ephemerally', async () => {
    const command = require('../../../src/commands/support');
    const interaction = {
      reply: jest.fn().mockResolvedValue(undefined),
    };

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        'Need help or want to report a bug? Join the SPRITEbot support server: https://discord.gg/eXktxzKxze',
      ephemeral: true,
    });
  });

  test('/verify assigns roles and reports subscriber and player matches', async () => {
    verifySupportMemberMock.mockResolvedValue({
      subscriberGuildIds: ['guild-1'],
      playerGuilds: [{ guild_id: 'guild-2', game_name: 'Lanternfall' }],
      assignedRoleIds: ['subscriber-role', 'player-role'],
      missingRoleIds: [],
    });
    const command = require('../../../src/commands/verify');
    const member = { id: 'member-1' };
    const interaction = createVerifyInteraction({ member });

    await command.execute(interaction);

    expect(interaction.guild.members.fetch).toHaveBeenCalledWith('user-1');
    expect(verifySupportMemberMock).toHaveBeenCalledWith(member);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: [
        '✅ Verified as **Subscriber** — you have an active subscription on **Subscribed Server**',
        "✅ Verified as **Player** — you're in a game on **Game Server**",
        'Your support server roles have been updated.',
      ].join('\n'),
      ephemeral: true,
    });
  });

  test('/verify explains when no membership is found', async () => {
    verifySupportMemberMock.mockResolvedValue({
      subscriberGuildIds: [],
      playerGuilds: [],
      assignedRoleIds: [],
      missingRoleIds: [],
    });
    const command = require('../../../src/commands/verify');
    const interaction = createVerifyInteraction();

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        '❌ No active subscription or game membership found. If you just subscribed, try again in a few minutes.',
      ephemeral: true,
    });
  });

  test('/verify explains role assignment failures', async () => {
    verifySupportMemberMock.mockRejectedValue(new Error('Missing Permissions'));
    const command = require('../../../src/commands/verify');
    const interaction = createVerifyInteraction();

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        '⚠️ I found the support server, but could not finish assigning verification roles. Please ask a server admin to check my role permissions and configured role IDs.',
      ephemeral: true,
    });
  });

  test('verify button assigns roles and reports matches', async () => {
    verifySupportMemberMock.mockResolvedValue({
      subscriberGuildIds: ['guild-1'],
      playerGuilds: [],
      assignedRoleIds: ['subscriber-role'],
      missingRoleIds: [],
    });
    const { handle } = require('../../../src/components/support_verify_button');
    const member = { id: 'member-1' };
    const interaction = createVerifyInteraction({ member });

    await handle(interaction);

    expect(interaction.guild.members.fetch).toHaveBeenCalledWith('user-1');
    expect(verifySupportMemberMock).toHaveBeenCalledWith(member);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: [
        '✅ Verified as **Subscriber** — you have an active subscription on **Subscribed Server**',
        'Your support server roles have been updated.',
      ].join('\n'),
      ephemeral: true,
    });
  });

  test('/verify-greeting posts Moldy-style copy with a verify button', async () => {
    const command = require('../../../src/commands/verify-greeting');
    const send = jest
      .fn()
      .mockResolvedValue({ url: 'https://discord.com/channels/support/vestibule/message' });
    const interaction = createVerifyInteraction({ userId: 'owner-1' });
    interaction.options = {
      getChannel: jest.fn().mockReturnValue({
        send,
        type: 0,
      }),
    };

    await command.execute(interaction);

    const payload = send.mock.calls[0][0];
    expect(payload.content).toContain('**Welcome to the SPRITEbot Support Server! 👋**');
    expect(payload.content).toContain('Click **Verify** below.');
    expect(payload.content).toContain('SPRITEbot will check');
    expect(payload.components[0].toJSON().components[0]).toEqual(
      expect.objectContaining({
        custom_id: 'supportVerify:verify',
        label: 'Verify',
      }),
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        '✅ Sent the verification greeting to https://discord.com/channels/support/vestibule/message',
      ephemeral: true,
    });
  });
});

function createVerifyInteraction({
  member = {},
  userId = 'user-1',
}: {
  member?: unknown;
  userId?: string;
} = {}) {
  const guilds = new Map([
    ['guild-1', { name: 'Subscribed Server' }],
    ['guild-2', { name: 'Game Server' }],
  ]);

  return {
    client: {
      guilds: {
        cache: guilds,
        fetch: jest.fn(async (guildId: string) => guilds.get(guildId) ?? null),
      },
    },
    guildId: '1526058725587292160',
    guild: {
      members: {
        fetch: jest.fn().mockResolvedValue(member),
      },
    },
    options: {
      getChannel: jest.fn(),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    user: { id: userId },
  };
}
