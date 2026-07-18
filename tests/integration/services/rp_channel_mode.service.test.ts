import {
  clearUserGuildInCharacterModes,
  isUserInCharacterForChannel,
  isUserInCharacterForChannelScope,
  setUserChannelInCharacterMode,
} from '../../../src/services/rp_channel_mode.service';

describe('rp_channel_mode.service', () => {
  test('defaults a user in a channel to out-of-character', async () => {
    await expect(isUserInCharacterForChannel('guild-1', 'channel-1', 'user-1')).resolves.toBe(
      false,
    );
  });

  test('toggles in-character mode per user per guild channel', async () => {
    await setUserChannelInCharacterMode({
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      isIc: true,
    });

    await expect(isUserInCharacterForChannel('guild-1', 'channel-1', 'user-1')).resolves.toBe(true);
    await expect(isUserInCharacterForChannel('guild-1', 'channel-1', 'user-2')).resolves.toBe(
      false,
    );
    await expect(isUserInCharacterForChannel('guild-1', 'channel-2', 'user-1')).resolves.toBe(
      false,
    );

    await setUserChannelInCharacterMode({
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      isIc: false,
    });

    await expect(isUserInCharacterForChannel('guild-1', 'channel-1', 'user-1')).resolves.toBe(
      false,
    );
  });

  test('lets an explicit thread OOC mode override an IC parent channel', async () => {
    await setUserChannelInCharacterMode({
      guildId: 'guild-1',
      channelId: 'parent-1',
      userId: 'user-1',
      isIc: true,
    });
    await setUserChannelInCharacterMode({
      guildId: 'guild-1',
      channelId: 'thread-1',
      userId: 'user-1',
      isIc: false,
    });

    await expect(
      isUserInCharacterForChannelScope({
        guildId: 'guild-1',
        channelId: 'thread-1',
        parentChannelId: 'parent-1',
        userId: 'user-1',
      }),
    ).resolves.toBe(false);
  });

  test('clears every IC channel mode for a user in one guild', async () => {
    for (const channelId of ['channel-1', 'channel-2']) {
      await setUserChannelInCharacterMode({
        guildId: 'guild-1',
        channelId,
        userId: 'user-1',
        isIc: true,
      });
    }

    await expect(clearUserGuildInCharacterModes('guild-1', 'user-1')).resolves.toBe(2);
    await expect(isUserInCharacterForChannel('guild-1', 'channel-1', 'user-1')).resolves.toBe(
      false,
    );
    await expect(isUserInCharacterForChannel('guild-1', 'channel-2', 'user-1')).resolves.toBe(
      false,
    );
  });
});
