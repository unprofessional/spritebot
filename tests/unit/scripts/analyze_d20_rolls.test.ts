const { buildFilteredQuery, summarizeRolls } =
  require('../../../scripts/analyze-d20-rolls.cjs') as {
    buildFilteredQuery(args: string[]): { text: string; values: unknown[] };
    summarizeRolls(rolls: number[]): {
      sampleSize: number;
      chiSquare: number;
      pValue: number | null;
      faces: Array<{ face: number; count: number; percentage: number }>;
    };
  };

describe('d20 roll analysis', () => {
  test('reports a perfectly uniform distribution', () => {
    const summary = summarizeRolls(Array.from({ length: 20 }, (_, index) => index + 1));

    expect(summary.sampleSize).toBe(20);
    expect(summary.chiSquare).toBe(0);
    expect(summary.pValue).toBeCloseTo(1, 8);
    expect(summary.faces).toEqual(
      Array.from({ length: 20 }, (_, index) => ({
        face: index + 1,
        count: 1,
        percentage: 5,
      })),
    );
  });

  test('flags a severely skewed sample with a very small p-value', () => {
    const summary = summarizeRolls(Array(100).fill(1));

    expect(summary.chiSquare).toBe(1900);
    expect(summary.pValue).toBeLessThan(0.000001);
  });

  test('rejects invalid stored results', () => {
    expect(() => summarizeRolls([0])).toThrow('Invalid d20 result');
  });

  test('builds parameterized context and time filters', () => {
    expect(
      buildFilteredQuery([
        '--guild=guild-1',
        '--channel=channel-1',
        '--user=user-1',
        '--since=2026-07-01T00:00:00Z',
        '--until=2026-08-01T00:00:00Z',
      ]),
    ).toEqual({
      text: 'SELECT result FROM d20_roll WHERE guild_id = $1 AND channel_id = $2 AND user_id = $3 AND created_at >= $4 AND created_at < $5 ORDER BY created_at, id',
      values: [
        'guild-1',
        'channel-1',
        'user-1',
        '2026-07-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
      ],
    });
  });

  test('rejects unknown analysis filters', () => {
    expect(() => buildFilteredQuery(['--server=guild-1'])).toThrow('Unknown filter');
  });
});
