// src/services/player.service.ts

import { PlayerDAO } from '../dao/player.dao';

const playerDAO = new PlayerDAO();

/**
 * Ensures global player record exists and sets up server-specific link.
 */
export async function getOrCreatePlayer(
  discordId: string,
  guildId: string,
  role: 'player' | 'gm' = 'player',
): Promise<Record<string, any>> {
  if (!guildId) throw new Error('guildId is required');
  await playerDAO.createGlobalPlayer(discordId);
  return await playerDAO.ensureServerLink(discordId, guildId, role);
}

/**
 * Sets the current active character for a player in a specific server.
 */
export async function setCurrentCharacter(
  discordId: string,
  guildId: string,
  characterId: string,
): Promise<Record<string, any>> {
  return await playerDAO.setCurrentCharacter(discordId, guildId, characterId);
}

/**
 * Retrieves the current character ID for a player in a specific server.
 */
export async function getCurrentCharacter(
  discordId: string,
  guildId: string,
): Promise<string | null> {
  return await playerDAO.getCurrentCharacter(discordId, guildId);
}

/**
 * Sets the current active game for a player in a specific server.
 */
export async function setCurrentGame(
  discordId: string,
  guildId: string,
  gameId: string,
): Promise<Record<string, any>> {
  console.log('[setCurrentGame] Attempting to set:', { discordId, guildId, gameId });
  const updated = await playerDAO.setCurrentGame(discordId, guildId, gameId);
  console.log('[setCurrentGame] Updated record:', updated);
  return updated;
}

/**
 * Retrieves the current game ID for a player in a specific server.
 */
export async function getCurrentGame(discordId: string, guildId: string): Promise<string | null> {
  return await playerDAO.getCurrentGame(discordId, guildId);
}
