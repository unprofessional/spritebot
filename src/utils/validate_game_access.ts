import { getGame } from '../services/game.service';
import type { Game } from '../types/game';

interface ValidateGameAccessOptions {
  game?: Game | null;
  gameId?: string | null;
  userId: string;
}

interface ValidateGameAccessResult {
  valid: boolean;
  warning?: string;
}

export async function validateGameAccess({
  game = null,
  gameId = null,
  userId,
}: ValidateGameAccessOptions): Promise<ValidateGameAccessResult> {
  let resolvedGame = game;

  if (!resolvedGame && gameId) {
    const maybeGame = await getGame({ id: gameId });

    // If you trust the return shape here
    if (
      maybeGame &&
      !Array.isArray(maybeGame) &&
      typeof maybeGame === 'object' &&
      'id' in maybeGame &&
      'name' in maybeGame
    ) {
      resolvedGame = maybeGame as Game;
    } else {
      resolvedGame = null;
    }
  }

  if (!resolvedGame) {
    return {
      valid: false,
      warning: "⚠️ This character's game no longer exists.",
    };
  }

  if (!resolvedGame.is_public && resolvedGame.created_by !== userId) {
    return {
      valid: true,
      warning:
        '⚠️ This game is no longer public. You can still view your character, but new players cannot join.',
    };
  }

  return { valid: true };
}
