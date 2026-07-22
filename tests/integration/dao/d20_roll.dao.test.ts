import { D20RollDAO } from '../../../src/dao/d20_roll.dao';
import { query } from '../../../src/db/client';

describe('D20RollDAO', () => {
  const dao = new D20RollDAO();

  test('records an outcome once per Discord interaction', async () => {
    const input = {
      interactionId: 'interaction-1',
      result: 1,
      userId: 'user-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
    };

    await dao.create(input);
    await dao.create(input);

    const recorded = await query<{
      result: number;
      user_id: string;
      guild_id: string | null;
      channel_id: string;
      created_at: string;
    }>(
      `SELECT result, user_id, guild_id, channel_id, created_at
       FROM d20_roll
       WHERE interaction_id = $1`,
      ['interaction-1'],
    );

    expect(recorded.rows).toEqual([
      {
        result: 1,
        user_id: 'user-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        created_at: expect.anything(),
      },
    ]);
  });

  test('database constraint rejects outcomes outside a d20', async () => {
    await expect(
      dao.create({
        interactionId: 'interaction-invalid',
        result: 21,
        userId: 'user-1',
        guildId: null,
        channelId: 'dm-1',
      }),
    ).rejects.toThrow();
  });
});
