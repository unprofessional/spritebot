import type { Game } from 'types/game';
import { GameDAO } from '../dao/game.dao';
import { StatTemplateDAO } from '../dao/stat_template.dao';

const gameDAO = new GameDAO();
const statTemplateDAO = new StatTemplateDAO();
const RESTORE_WINDOW_DAYS = 30;

export type GameMutationResult =
  | {
      ok: true;
      game: Game;
      characterCount: number;
      playerCount: number;
      rpModeCount: number;
    }
  | {
      ok: false;
      reason: 'not_found' | 'not_owner' | 'not_deleted' | 'already_deleted' | 'expired';
    };

interface StatTemplateInput {
  label: string;
  field_type?: 'short' | 'paragraph' | 'number' | 'count';
  default_value?: string | null;
  is_required?: boolean;
  sort_order?: number;
  meta?: Record<string, unknown>;
}

export async function createGame({
  name,
  description,
  createdBy,
  guildId,
}: {
  name: string;
  description: string;
  createdBy: string;
  guildId: string | null;
}): Promise<Game> {
  return gameDAO.create({
    name,
    description,
    created_by: createdBy,
    guild_id: guildId,
  }) as Promise<Game>;
}

export async function updateGame(
  gameId: string,
  updatePayload: { name: string; description?: string | null },
): Promise<Game | null> {
  return gameDAO.update(gameId, updatePayload) as Promise<Game | null>;
}

export async function getGame({
  id,
  guildId,
}: {
  id?: string;
  guildId?: string;
}): Promise<Game | null> {
  if (id) return gameDAO.findById(id) as Promise<Game | null>;
  if (guildId)
    return gameDAO.findByGuild(guildId).then((g) => g[0] ?? null) as Promise<Game | null>;
  return null;
}

/**
 * FIXME FIXME FIXME FIXME FIXME FIXME
 * @param id
 * @returns
 */
export async function getGameById(id: string): Promise<Game | null> {
  return gameDAO.findById(id) as Promise<Game | null>;
}

export async function getGamesByGuild(guildId: string): Promise<Game[]> {
  return gameDAO.findByGuild(guildId) as Promise<Game[]>;
}

export async function getGamesByUser(
  userId: string,
  guildId: string | null = null,
): Promise<Game[]> {
  const allGames = (await gameDAO.findByUser(userId)) as Game[];
  if (guildId) {
    return allGames.filter((g) => g.guild_id === guildId);
  }
  return allGames;
}

export async function getRestorableGames(userId: string, guildId: string): Promise<Game[]> {
  return gameDAO.findRestorableByUserInGuild(userId, guildId);
}

function restoreWindowExpired(deletedAt?: string | null): boolean {
  if (!deletedAt) return false;
  const deletedTime = new Date(deletedAt).getTime();
  const cutoff = Date.now() - RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return deletedTime < cutoff;
}

export async function deleteGame(gameId: string, requesterId: string): Promise<GameMutationResult> {
  const game = await gameDAO.findByIdIncludingDeleted(gameId);
  if (!game) return { ok: false, reason: 'not_found' };
  if (game.created_by !== requesterId) return { ok: false, reason: 'not_owner' };
  if (game.deleted_at) return { ok: false, reason: 'already_deleted' };

  const deleted = await gameDAO.softDeleteWithDependencies(gameId, requesterId);
  if (!deleted) return { ok: false, reason: 'not_found' };

  return { ok: true, ...deleted };
}

export async function restoreGame(
  gameId: string,
  requesterId: string,
): Promise<GameMutationResult> {
  const game = await gameDAO.findByIdIncludingDeleted(gameId);
  if (!game) return { ok: false, reason: 'not_found' };
  if (game.created_by !== requesterId) return { ok: false, reason: 'not_owner' };
  if (!game.deleted_at) return { ok: false, reason: 'not_deleted' };
  if (restoreWindowExpired(game.deleted_at)) return { ok: false, reason: 'expired' };

  const restored = await gameDAO.restoreWithDependencies(gameId, requesterId);
  if (!restored) return { ok: false, reason: 'not_found' };

  return { ok: true, ...restored };
}

export async function getStatTemplates(gameId: string) {
  return statTemplateDAO.findByGame(gameId);
}

export async function getStatTemplateById(statId: string) {
  return statTemplateDAO.findById(statId);
}

export async function updateStatTemplate(
  statId: string,
  updatePayload: Partial<StatTemplateInput>,
) {
  return statTemplateDAO.updateById(statId, updatePayload);
}

export async function deleteStatTemplate(statId: string) {
  return statTemplateDAO.deleteById(statId);
}

export async function addStatTemplates(gameId: string, templateList: StatTemplateInput[]) {
  return statTemplateDAO.bulkCreate(gameId, templateList);
}

export async function clearStatTemplates(gameId: string) {
  return statTemplateDAO.deleteByGame(gameId);
}

export async function publishGame(gameId: string): Promise<Game | null> {
  return gameDAO.publish(gameId) as Promise<Game | null>;
}

export async function togglePublish(gameId: string): Promise<Game | null> {
  return gameDAO.togglePublish(gameId) as Promise<Game | null>;
}
