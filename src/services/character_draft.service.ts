// src/services/character_draft.service.ts

import { CharacterDAO } from '../dao/character.dao';
import { CharacterStatFieldDAO } from '../dao/character_stat_field.dao';
import { getStatTemplates } from './game.service';

const characterDAO = new CharacterDAO();
const statFieldDAO = new CharacterStatFieldDAO();

// In-memory draft store
const drafts = new Map<string, { data: Record<string, any>; updatedAt: number }>();
const STALE_TIMEOUT = 1000 * 60 * 30; // 30 minutes
const MAX_DRAFTS = 1000;

function getDraftKey(userId: string): string {
  return `draft:${userId}`;
}

export function initDraft(userId: string): Record<string, any> | null {
  const key = getDraftKey(userId);
  if (!drafts.has(key)) {
    if (drafts.size >= MAX_DRAFTS) {
      console.warn('⚠️ Draft limit reached — new draft not created.');
      return null;
    }
    drafts.set(key, {
      data: {},
      updatedAt: Date.now(),
    });
    console.log(`🆕 Initialized new draft for user ${userId}`);
  } else {
    console.log(`🔄 Draft already exists for user ${userId}`);
  }
  return drafts.get(key)!.data;
}

export async function upsertTempCharacterField(
  userId: string,
  fieldKey: string,
  value: any,
  gameId: string | null = null,
  meta: any = null,
): Promise<void> {
  const key = getDraftKey(userId);
  if (!drafts.has(key)) {
    console.log(`ℹ️ Draft not found for user ${userId}, initializing...`);
    initDraft(userId);
  }

  const wrapper = drafts.get(key);
  if (!wrapper) {
    console.warn(`⚠️ Failed to get wrapper for draft key: ${key}`);
    return;
  }

  wrapper.data[fieldKey] = value;
  if (meta) {
    wrapper.data[`meta:${fieldKey}`] = meta;
  }

  wrapper.updatedAt = Date.now();

  if (gameId && !wrapper.data.game_id) {
    wrapper.data.game_id = gameId;
    console.log(`📝 Injected game_id (${gameId}) into draft for user ${userId}`);
  }

  console.log(`✏️ Draft field set [${fieldKey}] =`, value);
  if (meta) {
    console.log(`📦 Meta stored for [${fieldKey}]:`, meta);
  }
  console.log('🗂️ Current draft state:', JSON.stringify(wrapper.data, null, 2));
}

export async function getTempCharacterData(userId: string): Promise<Record<string, any> | null> {
  const wrapper = drafts.get(getDraftKey(userId)) || null;
  const draft = wrapper ? wrapper.data : null;
  console.log(`📄 getTempCharacterData(${userId}) →`, draft);
  return draft;
}

export async function getRemainingRequiredFields(
  userId: string,
): Promise<{ name: string; label: string }[]> {
  const draft = await getTempCharacterData(userId);
  if (!draft) {
    console.warn(`⚠️ No draft found for user ${userId}`);
    return [];
  }

  if (!draft.game_id) {
    console.warn(`⚠️ Draft for user ${userId} missing game_id`);
    return [];
  }

  const missing: { name: string; label: string }[] = [];

  const requiredCore = [
    { name: 'core:name', label: '[CORE] Name' },
    { name: 'core:bio', label: '[CORE] Bio' },
    { name: 'core:avatar_url', label: '[CORE] Avatar URL' },
  ];

  for (const core of requiredCore) {
    const val = draft[core.name];
    if (!val || !val.trim()) {
      missing.push(core);
    }
  }

  const statTemplates = await getStatTemplates(draft.game_id);
  console.log(`📐 Checking ${statTemplates.length} stat templates for required fields...`);

  for (const template of statTemplates) {
    if (!template.is_required) continue;
    const baseKey = `game:${template.id}`;
    if (template.field_type === 'count') {
      const meta = draft[`meta:${baseKey}`];
      if (!meta || !meta.max) {
        missing.push({ name: baseKey, label: `[GAME] ${template.label}` });
      }
    } else {
      const val = draft[baseKey];
      if (!val || !val.trim()) {
        missing.push({ name: baseKey, label: `[GAME] ${template.label}` });
      }
    }
  }

  console.log(`📋 Remaining required fields for user ${userId}:`, missing);
  return missing;
}

export async function isDraftComplete(userId: string): Promise<boolean> {
  const remaining = await getRemainingRequiredFields(userId);
  const complete = remaining.length === 0;
  console.log(`✅ isDraftComplete(${userId}) →`, complete);
  return complete;
}

export async function finalizeCharacterCreation(userId: string, draft: Record<string, any>) {
  const { game_id } = draft;

  console.log(`🚀 Finalizing character for user ${userId} in game ${game_id}`);
  console.log('🧾 Full draft:', JSON.stringify(draft, null, 2));

  const name = draft['core:name']?.trim();
  const avatar_url = draft['core:avatar_url']?.trim() || null;
  const bio = draft['core:bio']?.trim() || null;
  const visibility = draft['core:visibility'] || 'private';

  const character = await characterDAO.create({
    user_id: userId,
    game_id,
    name,
    avatar_url,
    bio,
    visibility,
  });

  console.log(`📌 Character created with ID: ${character.id}`);

  const statTemplates = await getStatTemplates(game_id);
  const statMap: Record<string, any> = {};

  for (const template of statTemplates) {
    const baseKey = `game:${template.id}`;
    if (template.field_type === 'count') {
      const meta = draft[`meta:${baseKey}`];
      if (meta?.max != null) {
        statMap[template.id] = {
          value: null,
          meta: {
            current: meta.current ?? meta.max,
            max: meta.max,
          },
        };
      }
    } else if (draft[baseKey]) {
      statMap[template.id] = {
        value: draft[baseKey],
        meta: null,
      };
    }
  }

  console.log('🧠 Final statMap to be upserted:', statMap);
  await statFieldDAO.bulkUpsert(character.id, statMap);

  drafts.delete(getDraftKey(userId));
  console.log(`🗑️ Cleared draft for user ${userId}`);

  return character;
}

export function purgeStaleDrafts(): void {
  const now = Date.now();
  for (const [key, { updatedAt }] of drafts.entries()) {
    if (now - updatedAt > STALE_TIMEOUT) {
      drafts.delete(key);
      console.log(`🧹 Purged stale draft: ${key}`);
    }
  }
}

// Cleanup timer
setInterval(purgeStaleDrafts, 1000 * 60 * 5); // Every 5 minutes
