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
  beforeEach(() => {
    jest.clearAllMocks();
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
});

function createVerifyInteraction({ member = {} }: { member?: unknown } = {}) {
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
    reply: jest.fn().mockResolvedValue(undefined),
    user: { id: 'user-1' },
  };
}
