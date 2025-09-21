// src/services/character.service.ts

import { FieldInput } from 'types/field_input';
import { CharacterDAO } from '../dao/character.dao';
import { CharacterCustomFieldDAO } from '../dao/character_custom_field.dao';
import type { StatFieldEntry } from '../dao/character_stat_field.dao';
import { CharacterStatFieldDAO } from '../dao/character_stat_field.dao';
import { PlayerDAO } from '../dao/player.dao';
import type {
  CharacterWithStats,
  HydratedStatField,
  HydratedCustomField,
  UserDefinedField,
} from '../types/character';
import { getStatTemplates } from './game.service';
import { getCurrentGame } from './player.service';

const characterDAO = new CharacterDAO();
const statDAO = new CharacterStatFieldDAO();
const customDAO = new CharacterCustomFieldDAO();
const playerDAO = new PlayerDAO();

export async function createCharacter({
  userId,
  guildId,
  gameId,
  name,
  avatar_url = null,
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

  const stats = await statDAO.findByCharacter(characterId);
  const custom = await customDAO.findByCharacter(characterId);
  const templates = await getStatTemplates(character.game_id);

  const templateMap = Object.fromEntries(templates.map((t) => [t.id, t]));

  const enrichedStats: HydratedStatField[] = stats.map((stat) => {
    const template = templateMap[stat.template_id];
    return {
      ...stat,
      label: template?.label || stat.template_id,
      field_type: template?.field_type || 'short',
    };
  });

  const hydrated: CharacterWithStats = {
    ...(character as CharacterWithStats), // 👈 This cast satisfies TS
    stats: enrichedStats,
    customFields: custom as HydratedCustomField[],
  };

  return hydrated;
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
    bio: string | null;
    visibility: 'public' | 'private';
  }>,
) {
  const existing = await characterDAO.findById(characterId);
  if (!existing) throw new Error('Character not found');

  const merged = {
    name: existing.name,
    avatar_url: existing.avatar_url,
    bio: existing.bio,
    visibility: existing.visibility,
    ...fields,
  };

  return characterDAO.updateMeta(characterId, merged);
}

export async function deleteCharacter(characterId: string) {
  await statDAO.deleteByCharacter(characterId);
  await customDAO.deleteByCharacter(characterId);
  await characterDAO.delete(characterId);
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

  if (!target) throw new Error(`Stat ${templateId} not found on character ${characterId}`);

  const updatedMeta = {
    ...(target.meta || {}),
    [metaKey]: newValue,
  };

  return statDAO.create(characterId, templateId, target.value ?? '', updatedMeta);
}

// raw access for validations (user_id, game_id, etc.)
export async function getCharacterById(characterId: string) {
  return characterDAO.findById(characterId);
}

export async function belongsToUser(characterId: string, userId: string): Promise<boolean> {
  const c = await characterDAO.findById(characterId);
  return !!c && c.user_id === userId;
}
