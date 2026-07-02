import { parseDiscordMessageReference } from '../../../src/utils/discord_message_reference';

describe('parseDiscordMessageReference', () => {
  test('parses a raw message ID using the fallback channel', () => {
    expect(parseDiscordMessageReference('123456789012345678', 'channel-1')).toEqual({
      channelId: 'channel-1',
      messageId: '123456789012345678',
    });
  });

  test('parses a Discord message link', () => {
    expect(
      parseDiscordMessageReference(
        'https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333',
        'fallback-channel',
      ),
    ).toEqual({
      guildId: '111111111111111111',
      channelId: '222222222222222222',
      messageId: '333333333333333333',
    });
  });

  test('rejects invalid references', () => {
    expect(parseDiscordMessageReference('not-a-message', 'channel-1')).toBeNull();
  });
});
