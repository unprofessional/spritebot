// src/utils/is_active_character.ts

import { getCurrentCharacter } from '../services/player.service';

/**
 * Returns true if the given characterId is the player's currently active character in this guild.
 */
export async function isActiveCharacter(
  userId: string,
  guildId: string,
  characterId: string,
): Promise<boolean> {
  if (!userId || !guildId || !characterId) return false;
  try {
    const current = await getCurrentCharacter(userId, guildId);
    return current === characterId;
  } catch (err) {
    console.error('[isActiveCharacter] Failed to check:', { userId, guildId, characterId }, err);
    return false;
  }
}
