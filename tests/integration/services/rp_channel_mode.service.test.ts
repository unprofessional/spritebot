import {
  isChannelInCharacter,
  setChannelInCharacterMode,
} from '../../../src/services/rp_channel_mode.service';

describe('rp_channel_mode.service', () => {
  test('defaults a channel to out-of-character', async () => {
    await expect(isChannelInCharacter('guild-1', 'channel-1')).resolves.toBe(false);
  });

  test('toggles in-character mode per guild channel', async () => {
    await setChannelInCharacterMode({
      guildId: 'guild-1',
      channelId: 'channel-1',
      isIc: true,
      updatedBy: 'gm-1',
    });

    await expect(isChannelInCharacter('guild-1', 'channel-1')).resolves.toBe(true);
    await expect(isChannelInCharacter('guild-1', 'channel-2')).resolves.toBe(false);

    await setChannelInCharacterMode({
      guildId: 'guild-1',
      channelId: 'channel-1',
      isIc: false,
      updatedBy: 'gm-1',
    });

    await expect(isChannelInCharacter('guild-1', 'channel-1')).resolves.toBe(false);
  });
});
