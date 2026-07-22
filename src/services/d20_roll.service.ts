import { D20RollDAO } from '../dao/d20_roll.dao';

const d20RollDAO = new D20RollDAO();

export async function recordD20Roll({
  numDice,
  numSides,
  result,
  interactionId,
}: {
  numDice: number;
  numSides: number;
  result: number;
  interactionId: string;
}): Promise<boolean> {
  if (numDice !== 1 || numSides !== 20) return false;

  await d20RollDAO.create({ interactionId, result });
  return true;
}
