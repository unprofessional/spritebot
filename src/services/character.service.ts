// src/services/character.service.ts

import { FieldInput } from 'types/field_input';
import { CharacterDAO } from '../dao/character.dao';
import { CharacterCustomFieldDAO } from '../dao/character_custom_field.dao';
import type { StatFieldEntry } from '../dao/character_stat_field.dao';
import { CharacterStatFieldDAO } from '../dao/character_stat_field.dao';
import { PlayerDAO } from '../dao/player.dao';
import type {
  Character,
  CharacterWithStats,
  HydratedStatField,
  HydratedCustomField,
  UserDefinedField,
} from '../types/character';
import { getCountStatDefaults } from '../utils/count_stat_defaults';
import { getStatTemplates } from './game.service';
import { getInventory } from './inventory.service';
import { getCurrentGame, setCurrentCharacter } from './player.service';

const characterDAO = new CharacterDAO();
const statDAO = new CharacterStatFieldDAO();
const customDAO = new CharacterCustomFieldDAO();
const playerDAO = new PlayerDAO();
const RESTORE_WINDOW_DAYS = 30;

export type RestoreCharacterResult =
  | { ok: true; character: CharacterWithStats }
  | { ok: false; reason: 'not_found' | 'not_deleted' | 'not_owner' | 'expired' };

export async function createCharacter({
  userId,
  guildId,
  gameId,
  name,
  avatar_url = null,
  rp_display_name = null,
  rp_display_avatar_url = null,
  bio = null,
  visibility = 'private',
  stats = {},
  customFields = {},
}: {
  userId: string;
  guildId: string;
  gameId: string;
  name: string;
  avatar_url?: string | null;
  rp_display_name?: string | null;
  rp_display_avatar_url?: string | null;
  bio?: string | null;
  visibility?: 'public' | 'private';
  stats?: Record<string, string | StatFieldEntry>;
  customFields?: Record<string, FieldInput>;
}) {
  const character = await characterDAO.create({
    user_id: userId,
    game_id: gameId,
    name,
    avatar_url,
    rp_display_name,
    rp_display_avatar_url,
    bio,
    visibility,
  });

  if (stats && typeof stats === 'object') {
    await statDAO.bulkUpsert(character.id, stats);
  }

  if (customFields && typeof customFields === 'object') {
    await customDAO.bulkUpsert(character.id, customFields);
  }

  await playerDAO.setCurrentCharacter(userId, guildId, character.id);

  return character;
}

export async function getCharacterWithStats(
  characterId: string,
): Promise<CharacterWithStats | null> {
  const character = await characterDAO.findById(characterId);
  if (!character) {
    console.warn('⚠️ Character not found:', characterId);
    return null;
  }

  if (character.deleted_at) return null;

  const stats = await statDAO.findByCharacter(characterId);
  const custom = await customDAO.findByCharacter(characterId);
  const templates = await getStatTemplates(character.game_id);
  const inventory = await getInventory(characterId);

  const statMap = new Map(stats.map((stat) => [stat.template_id, stat]));
  const templateIds = new Set(templates.map((template) => template.id));

  const enrichedStats: HydratedStatField[] = templates.map((template) => {
    const stat = statMap.get(template.id);
    const countDefaults = template.field_type === 'count' ? getCountStatDefaults(template) : null;
    return {
      template_id: template.id,
      value: stat?.value ?? template.default_value ?? '',
      meta:
        stat?.meta ??
        (countDefaults && countDefaults.max !== null
          ? { max: countDefaults.max, current: countDefaults.current }
          : {}),
      label: template.label || template.id,
      field_type: template.field_type || 'short',
      sort_index: template.sort_order ?? 999,
    };
  });

  for (const stat of stats) {
    if (templateIds.has(stat.template_id)) continue;

    enrichedStats.push({
      ...stat,
      label: stat.template_id,
      field_type: 'short',
      sort_index: 999,
    });
  }

  const hydrated: CharacterWithStats = {
    ...(character as CharacterWithStats), // 👈 This cast satisfies TS
    stats: enrichedStats,
    customFields: custom as HydratedCustomField[],
    inventory,
  };

  return hydrated;
}

export async function getCurrentCharacterForUser(
  userId: string,
  guildId: string,
): Promise<Character | null> {
  const characterId = await playerDAO.getCurrentCharacter(userId, guildId);
  if (!characterId) return null;

  const character = await characterDAO.findActiveById(characterId);
  return character?.user_id === userId ? character : null;
}

export async function getCharactersByUser(userId: string, guildId: string) {
  const currentGameId = await getCurrentGame(userId, guildId);
  if (!currentGameId) return [];

  const all = await characterDAO.findByUser(userId);
  return all.filter((c) => c.game_id === currentGameId);
}

export async function getCharactersByGame(gameId: string) {
  return characterDAO.findByGame(gameId);
}

export async function updateStat(characterId: string, statName: string, newValue: string) {
  return statDAO.create(characterId, statName, newValue);
}

export async function updateStats(
  characterId: string,
  statMap: Record<string, string | StatFieldEntry>,
) {
  return statDAO.bulkUpsert(characterId, statMap);
}

export async function updateCharacterMeta(
  characterId: string,
  fields: Partial<{
    name: string;
    avatar_url: string | null;
    rp_display_name: string | null;
    rp_display_avatar_url: string | null;
    bio: string | null;
    visibility: 'public' | 'private';
  }>,
) {
  const existing = await characterDAO.findById(characterId);
  if (!existing) throw new Error('Character not found');

  const merged = {
    name: existing.name,
    avatar_url: existing.avatar_url,
    rp_display_name: existing.rp_display_name,
    rp_display_avatar_url: existing.rp_display_avatar_url,
    bio: existing.bio,
    visibility: existing.visibility,
    ...fields,
  };

  return characterDAO.updateMeta(characterId, merged);
}

export async function deleteCharacter(characterId: string) {
  await characterDAO.softDeleteWithDependencies(characterId);
}

export async function getRestorableCharacters(userId: string, guildId: string) {
  const currentGameId = await getCurrentGame(userId, guildId);
  if (!currentGameId) return [];

  return characterDAO.findRestorableByUserInGame(userId, currentGameId);
}

function restoreWindowExpired(deletedAt?: string | null): boolean {
  if (!deletedAt) return false;
  const deletedTime = new Date(deletedAt).getTime();
  const cutoff = Date.now() - RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return deletedTime < cutoff;
}

async function hydrateRestoredCharacter(characterId: string): Promise<CharacterWithStats | null> {
  const character = await getCharacterWithStats(characterId);
  return character;
}

export async function restoreCharacterForUser({
  characterId,
  userId,
  guildId,
}: {
  characterId: string;
  userId: string;
  guildId: string;
}): Promise<RestoreCharacterResult> {
  const currentGameId = await getCurrentGame(userId, guildId);
  const character = await characterDAO.findById(characterId);

  if (!character || !currentGameId || character.game_id !== currentGameId) {
    return { ok: false, reason: 'not_found' };
  }

  if (!character.deleted_at) return { ok: false, reason: 'not_deleted' };
  if (character.user_id !== userId) return { ok: false, reason: 'not_owner' };
  if (restoreWindowExpired(character.deleted_at)) return { ok: false, reason: 'expired' };

  await characterDAO.restore(characterId);
  await setCurrentCharacter(userId, guildId, characterId);

  const restored = await hydrateRestoredCharacter(characterId);
  if (!restored) return { ok: false, reason: 'not_found' };

  return { ok: true, character: restored };
}

export async function restoreCharacterAsAdmin(
  characterId: string,
): Promise<RestoreCharacterResult> {
  const character = await characterDAO.findById(characterId);

  if (!character) return { ok: false, reason: 'not_found' };
  if (!character.deleted_at) return { ok: false, reason: 'not_deleted' };

  await characterDAO.restore(characterId);

  const restored = await hydrateRestoredCharacter(characterId);
  if (!restored) return { ok: false, reason: 'not_found' };

  return { ok: true, character: restored };
}

export async function getUserDefinedFields(userId: string): Promise<UserDefinedField[]> {
  console.log('🔧 getUserDefinedFields > userId:', userId);
  return [
    {
      name: 'backstory',
      label: 'Backstory',
    },
    {
      name: 'quirk',
      label: 'Quirk',
    },
  ];
}

export async function getCharacterSummary(character: { id: string; game_id: string }) {
  const statFields = await statDAO.findByCharacter(character.id);
  const templates = await getStatTemplates(character.game_id);

  const templateMap = Object.fromEntries(templates.map((t) => [t.id, t]));

  const enriched = statFields
    .map((field) => {
      const template = templateMap[field.template_id];
      return {
        label: template?.label || 'Unknown',
        sort_order: template?.sort_order ?? 999,
        value: field.value,
      };
    })
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.label.localeCompare(b.label);
    })
    .slice(0, 2);

  return enriched;
}

export async function updateStatMetaField(
  characterId: string,
  templateId: string,
  metaKey: string,
  newValue: unknown,
) {
  const existingStats = await statDAO.findByCharacter(characterId);
  const target = existingStats.find((s) => s.template_id === templateId);

  if (!target) {
    return statDAO.create(characterId, templateId, '', { [metaKey]: newValue });
  }

  const updatedMeta = {
    ...(target.meta || {}),
    [metaKey]: newValue,
  };

  return statDAO.create(characterId, templateId, target.value ?? '', updatedMeta);
}

// raw access for validations (user_id, game_id, etc.)
export async function getCharacterById(characterId: string) {
  const character = await characterDAO.findById(characterId);
  return character?.deleted_at ? null : character;
}

export async function belongsToUser(characterId: string, userId: string): Promise<boolean> {
  const c = await characterDAO.findById(characterId);
  return !!c && c.user_id === userId;
}
