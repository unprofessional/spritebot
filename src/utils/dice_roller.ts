import { randomInt } from 'node:crypto';

export const MIN_DICE = 1;
export const MAX_DICE = 15;
export const MIN_SIDES = 2;
export const MAX_SIDES = 999;

export type RollResult = {
  numDice: number;
  numSides: number;
  rolls: number[];
  total: number;
};

export type RandomInt = (min: number, max: number) => number;

export function parseDiceExpression(input: string): { numDice: number; numSides: number } {
  const expression = input.trim();
  const shorthand = expression.match(/^(\d+)d(\d+)$/i);

  if (!shorthand) {
    throw new Error('Use a roll like 2d20 or 2D20.');
  }

  const numDice = Number(shorthand[1]);
  const numSides = Number(shorthand[2]);
  validateDiceInput(numDice, numSides);
  return { numDice, numSides };
}

export function validateDiceInput(numDice: number, numSides: number): void {
  if (!Number.isInteger(numDice) || numDice < MIN_DICE || numDice > MAX_DICE) {
    throw new Error(`numDice must be an integer from ${MIN_DICE} to ${MAX_DICE}.`);
  }

  if (!Number.isInteger(numSides) || numSides < MIN_SIDES || numSides > MAX_SIDES) {
    throw new Error(`numSides must be an integer from ${MIN_SIDES} to ${MAX_SIDES}.`);
  }
}

export function rollDice(
  numDice: number,
  numSides: number,
  nextInt: RandomInt = randomInt,
): RollResult {
  validateDiceInput(numDice, numSides);

  const rolls = Array.from({ length: numDice }, () => nextInt(1, numSides + 1));
  const total = rolls.reduce((sum, roll) => sum + roll, 0);

  return {
    numDice,
    numSides,
    rolls,
    total,
  };
}

export function formatRollResult(result: RollResult, rollerName?: string): string {
  const expression = `${result.numDice}d${result.numSides}`;
  const rollList = `[${result.rolls.join(', ')}]`;
  const prefix = rollerName ? `🎲 **${rollerName}** rolled` : '🎲 Rolled';

  return `${prefix} \`${expression}\`: \`${rollList}\` = **${result.total}**`;
}
