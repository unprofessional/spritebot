import {
  formatRollResult,
  parseDiceExpression,
  rollDice,
  validateDiceInput,
} from '../../../src/utils/dice_roller';

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

  test('parses shorthand dice expressions', () => {
    expect(parseDiceExpression('2d20')).toEqual({ numDice: 2, numSides: 20 });
    expect(parseDiceExpression('2D20')).toEqual({ numDice: 2, numSides: 20 });
    expect(parseDiceExpression(' 4d12 ')).toEqual({ numDice: 4, numSides: 12 });
  });

  test('rejects unsupported dice expressions', () => {
    expect(() => validateDiceInput(0, 6)).toThrow('numDice');
    expect(() => validateDiceInput(16, 6)).toThrow('numDice');
    expect(() => validateDiceInput(1, 1)).toThrow('numSides');
    expect(() => validateDiceInput(1, 1000)).toThrow('numSides');
    expect(() => parseDiceExpression('two d twenty')).toThrow('Use a roll');
    expect(() => parseDiceExpression('4 d 12')).toThrow('Use a roll');
    expect(() => parseDiceExpression('1 die 2 sides')).toThrow('Use a roll');
    expect(() => parseDiceExpression('2 dice 20 sides')).toThrow('Use a roll');
    expect(() => parseDiceExpression('20 sides 2 dice')).toThrow('Use a roll');
    expect(() => parseDiceExpression('dice 2 with sides 20')).toThrow('Use a roll');
  });

  test('formats roll results', () => {
    expect(
      formatRollResult(
        { numDice: 4, numSides: 20, rolls: [14, 14, 13, 1], total: 42 },
        'Robin Sage',
      ),
    ).toBe('🎲 **Robin Sage** rolled `4d20`: `[14, 14, 13, 1]` = **42**');
    expect(formatRollResult({ numDice: 3, numSides: 6, rolls: [2, 4, 6], total: 12 })).toBe(
      '🎲 Rolled `3d6`: `[2, 4, 6]` = **12**',
    );
  });
});
