const mockUpsertGift = jest.fn();

jest.mock('../../../src/dao/gifted_guilds.dao', () => ({
  GiftedGuildsDAO: jest.fn().mockImplementation(() => ({
    upsertGift: mockUpsertGift,
  })),
}));

describe('/gift', () => {
  const originalOwnerId = process.env.OWNER_DISCORD_ID;

  beforeEach(() => {
    jest.resetModules();
    mockUpsertGift.mockResolvedValue({});
    process.env.OWNER_DISCORD_ID = 'owner-1';
  });

  afterEach(() => {
    if (originalOwnerId == null) delete process.env.OWNER_DISCORD_ID;
    else process.env.OWNER_DISCORD_ID = originalOwnerId;
    jest.restoreAllMocks();
  });

  test('rejects users outside the owner allowlist', async () => {
    const command = require('../../../src/commands/gift');
    const interaction = {
      reply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'support-admin-1' },
    };

    await command.execute(interaction, {
      responder: { respond: interaction.reply },
    });

    expect(interaction.reply).toHaveBeenCalledWith({
      content: '⛔ Not authorized.',
      ephemeral: true,
    });
  });

  test('records a gifted guild recipient member id', async () => {
    const command = require('../../../src/commands/gift');
    const interaction = {
      options: {
        getSubcommand: jest.fn().mockReturnValue('add'),
        getString: jest.fn((name: string) => {
          if (name === 'guild_id') return 'guild-1';
          if (name === 'recipient_member_id') return 'recipient-1';
          if (name === 'note') return 'manual comp';
          return null;
        }),
        getInteger: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'owner-1' },
    };

    await command.execute(interaction, {
      responder: { respond: interaction.reply },
    });

    expect(mockUpsertGift).toHaveBeenCalledWith({
      guildId: 'guild-1',
      grantedBy: 'owner-1',
      recipientMemberId: 'recipient-1',
      note: 'manual comp',
      expiresAt: null,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: '✅ Gifted **guild-1** to <@recipient-1> (no expiry).',
      ephemeral: true,
    });
  });
});
