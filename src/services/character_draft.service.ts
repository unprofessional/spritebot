// src/services/character_draft.service.ts

import { CharacterDAO } from '../dao/character.dao';
import { CharacterStatFieldDAO } from '../dao/character_stat_field.dao';
import type { CharacterDraft } from '../types/character';
import { getStatTemplates } from './game.service';

const characterDAO = new CharacterDAO();
const statFieldDAO = new CharacterStatFieldDAO();

const drafts = new Map<string, { draft: CharacterDraft; updatedAt: number }>();
const STALE_TIMEOUT = 1000 * 60 * 30;
const MAX_DRAFTS = 1000;

function getDraftKey(userId: string): string {
  return `draft:${userId}`;
}

export function initDraft(userId: string): CharacterDraft | null {
  const key = getDraftKey(userId);
  if (!drafts.has(key)) {
    if (drafts.size >= MAX_DRAFTS) {
      console.warn('⚠️ Draft limit reached — new draft not created.');
      return null;
    }

    const newDraft: CharacterDraft = {
      id: crypto.randomUUID(),
      user_id: userId,
      game_id: '',
      data: {},
    };

    drafts.set(key, { draft: newDraft, updatedAt: Date.now() });
    console.log(`🆕 Initialized new draft for user ${userId}`);
  } else {
    console.log(`🔄 Draft already exists for user ${userId}`);
  }

  return drafts.get(key)!.draft;
}

export async function getTempCharacterData(userId: string): Promise<CharacterDraft | null> {
  const wrapper = drafts.get(getDraftKey(userId)) || null;
  return wrapper?.draft ?? null;
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

  const draft = wrapper.draft;
  draft.data[fieldKey] = value;
  if (meta) {
    draft.data[`meta:${fieldKey}`] = meta;
  }

  if (gameId && !draft.game_id) {
    draft.game_id = gameId;
    console.log(`📝 Injected game_id (${gameId}) into draft for user ${userId}`);
  }

  wrapper.updatedAt = Date.now();

  console.log(`✏️ Draft field set [${fieldKey}] =`, value);
  if (meta) {
    console.log(`📦 Meta stored for [${fieldKey}]:`, meta);
  }
  console.log('🗂️ Current draft state:', JSON.stringify(draft, null, 2));
}

export async function getRemainingRequiredFields(
  userId: string,
): Promise<{ name: string; label: string }[]> {
  const draft = await getTempCharacterData(userId);
  if (!draft || !draft.game_id) {
    console.warn(`⚠️ Missing draft or game_id for user ${userId}`);
    return [];
  }

  const missing: { name: string; label: string }[] = [];

  const requiredCore = [
    { name: 'core:name', label: '[CORE] Name' },
    { name: 'core:bio', label: '[CORE] Bio' },
    { name: 'core:avatar_url', label: '[CORE] Avatar URL' },
  ];

  for (const core of requiredCore) {
    const val = draft.data[core.name];
    if (!val || !val.trim?.()) {
      missing.push(core);
    }
  }

  const statTemplates = await getStatTemplates(draft.game_id);
  for (const template of statTemplates) {
    if (!template.is_required) continue;
    const baseKey = `game:${template.id}`;
    if (template.field_type === 'count') {
      const meta = draft.data[`meta:${baseKey}`];
      if (!meta || !meta.max) {
        missing.push({ name: baseKey, label: `[GAME] ${template.label}` });
      }
    } else {
      const val = draft.data[baseKey];
      if (!val || !val.trim?.()) {
        missing.push({ name: baseKey, label: `[GAME] ${template.label}` });
      }
    }
  }

  return missing;
}

export async function isDraftComplete(userId: string): Promise<boolean> {
  const remaining = await getRemainingRequiredFields(userId);
  return remaining.length === 0;
}

export async function finalizeCharacterCreation(userId: string, draft: CharacterDraft) {
  const { game_id } = draft;
  console.log(`🚀 Finalizing character for user ${userId} in game ${game_id}`);
  console.log('🧾 Full draft:', JSON.stringify(draft, null, 2));

  const name = draft.data['core:name']?.trim();
  const avatar_url = draft.data['core:avatar_url']?.trim() || null;
  const bio = draft.data['core:bio']?.trim() || null;
  const visibility = draft.data['core:visibility'] || 'private';

  const character = await characterDAO.create({
    user_id: userId,
    game_id,
    name,
    avatar_url,
    bio,
    visibility,
  });

  const statTemplates = await getStatTemplates(game_id);
  const statMap: Record<string, any> = {};

  for (const template of statTemplates) {
    const baseKey = `game:${template.id}`;
    if (template.field_type === 'count') {
      const meta = draft.data[`meta:${baseKey}`];
      if (meta?.max != null) {
        statMap[template.id] = {
          value: null,
          meta: {
            current: meta.current ?? meta.max,
            max: meta.max,
          },
        };
      }
    } else if (draft.data[baseKey]) {
      statMap[template.id] = {
        value: draft.data[baseKey],
        meta: null,
      };
    }
  }

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

setInterval(purgeStaleDrafts, 1000 * 60 * 5);
