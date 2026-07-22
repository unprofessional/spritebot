import { D20RollDAO } from '../../../src/dao/d20_roll.dao';
import { query } from '../../../src/db/client';

describe('D20RollDAO', () => {
  const dao = new D20RollDAO();

  test('records an outcome once per Discord interaction', async () => {
    const input = {
      interactionId: 'interaction-1',
      result: 1,
    };

    await dao.create(input);
    await dao.create(input);

    const recorded = await query<{
      result: number;
      created_at: string;
    }>(
      `SELECT result, created_at
       FROM d20_roll
       WHERE interaction_id = $1`,
      ['interaction-1'],
    );

    expect(recorded.rows).toEqual([
      {
        result: 1,
        created_at: expect.anything(),
      },
    ]);
  });

  test('database constraint rejects outcomes outside a d20', async () => {
    await expect(
      dao.create({
        interactionId: 'interaction-invalid',
        result: 21,
      }),
    ).rejects.toThrow();
  });
});
