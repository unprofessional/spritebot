import {
  DISCORD_CUSTOM_ID_MAX_LENGTH,
  discordCustomId,
} from '../../../src/utils/discord_custom_id';

describe('discordCustomId', () => {
  test('returns valid IDs unchanged at the Discord boundary', () => {
    expect(discordCustomId('action:entity-id')).toBe('action:entity-id');
    expect(discordCustomId('x'.repeat(DISCORD_CUSTOM_ID_MAX_LENGTH))).toHaveLength(100);
  });

  test('rejects empty and oversized IDs before discord.js sees them', () => {
    expect(() => discordCustomId('')).toThrow('between 1 and 100 characters');
    expect(() => discordCustomId('x'.repeat(101))).toThrow('received 101');
  });
});
