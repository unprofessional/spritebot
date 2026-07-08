import { formatRollResult, rollDice, validateDiceInput } from '../../../src/utils/dice_roller';

describe('dice_roller', () => {
  test('rolls each die with crypto-style exclusive upper bound and totals the result', () => {
    const nextInt = jest.fn().mockReturnValueOnce(2).mockReturnValueOnce(4).mockReturnValueOnce(6);

    const result = rollDice(3, 6, nextInt);

    expect(nextInt).toHaveBeenCalledTimes(3);
    expect(nextInt).toHaveBeenNthCalledWith(1, 1, 7);
    expect(result).toEqual({
      numDice: 3,
      numSides: 6,
      rolls: [2, 4, 6],
      total: 12,
    });
  });

  test('accepts the supported command range', () => {
    expect(() => validateDiceInput(1, 2)).not.toThrow();
    expect(() => validateDiceInput(15, 999)).not.toThrow();
  });

  test('rejects unsupported dice expressions', () => {
    expect(() => validateDiceInput(0, 6)).toThrow('numDice');
    expect(() => validateDiceInput(16, 6)).toThrow('numDice');
    expect(() => validateDiceInput(1, 1)).toThrow('numSides');
    expect(() => validateDiceInput(1, 1000)).toThrow('numSides');
  });

  test('formats single and multiple dice results', () => {
    expect(formatRollResult({ numDice: 1, numSides: 20, rolls: [17], total: 17 })).toBe(
      '🎲 Rolled 1d20: **17**',
    );
    expect(formatRollResult({ numDice: 3, numSides: 6, rolls: [2, 4, 6], total: 12 })).toBe(
      '🎲 Rolled 3d6: 2 + 4 + 6 = **12**',
    );
  });
});
