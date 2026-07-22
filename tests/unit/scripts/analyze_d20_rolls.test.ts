const { summarizeRolls } = require('../../../scripts/analyze-d20-rolls.cjs') as {
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
});
