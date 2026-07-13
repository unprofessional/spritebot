jest.mock('../../../src/dao/gifted_guilds.dao', () => ({
  GiftedGuildsDAO: jest.fn().mockImplementation(() => ({
    upsertGift: jest.fn(),
  })),
}));

describe('/gift', () => {
  const originalOwnerId = process.env.OWNER_DISCORD_ID;

  beforeEach(() => {
    jest.resetModules();
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

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: '⛔ Not authorized.',
      ephemeral: true,
    });
  });
});
