// src/components/rebuild_list_characters_response.ts

import { ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder } from 'discord.js';

import { getCharacterWithStats } from '../services/character.service';
import { getCurrentCharacter } from '../services/player.service';
import { formatTimeAgo } from '../utils/time_ago';

import type { CharacterStatWithLabel } from '../types/character';

import { build as buildCharacterSelector } from './public_character_selector';
import { build as buildPaginationButtons } from './character_page_buttons';

interface CharacterPreview {
  id: string;
  name: string;
  created_at: string;
  visibility: string;
}

interface HydratedCharacter {
  id: string;
  label: string;
  description: string;
  isActive: boolean;
}

/**
 * Builds the message content and components for paginated public character listing.
 */
async function rebuildListCharactersResponse(
  characters: CharacterPreview[],
  page = 0,
  userId: string,
  guildId: string,
): Promise<{
  content: string;
  components: (ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>)[];
}> {
  const PAGE_SIZE = 25;
  const currentCharacterId = await getCurrentCharacter(userId, guildId);
  const hydrated: HydratedCharacter[] = [];

  for (const char of characters) {
    try {
      const full = await getCharacterWithStats(char.id);
      if (!full) continue;

      const isActive = full.id === currentCharacterId;
      const baseLabel = `${full.name} — ${formatTimeAgo(full.created_at || '')}`;
      const label = isActive ? `⭐ ${baseLabel} (ACTIVE)` : baseLabel;

      const topStats = [...(full.stats || [])].slice(0, 4).map((stat: CharacterStatWithLabel) => {
        if (stat.field_type === 'count') {
          const current = stat.meta?.current ?? '?';
          const max = stat.meta?.max ?? '?';
          return `${stat.label}: ${current} / ${max}`;
        } else {
          return `${stat.label}: ${stat.value}`;
        }
      });

      const description = topStats.join(' • ') || full.bio || 'No stats available';

      hydrated.push({
        id: full.id,
        label: label.slice(0, 100),
        description: description.slice(0, 100),
        isActive,
      });
    } catch (err) {
      console.error(`❌ Failed to hydrate or format character ${char.name} (${char.id}):`, err);
    }
  }

  hydrated.sort((a, b) => Number(b.isActive) - Number(a.isActive));

  const totalPages = Math.ceil(hydrated.length / PAGE_SIZE);
  const pageSlice = hydrated.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const components: (
    | ActionRowBuilder<StringSelectMenuBuilder>
    | ActionRowBuilder<ButtonBuilder>
  )[] = [buildCharacterSelector(page, pageSlice)];

  if (hydrated.length > PAGE_SIZE) {
    components.push(
      buildPaginationButtons(page, page > 0, (page + 1) * PAGE_SIZE < hydrated.length),
    );
  }

  return {
    content: `📖 **Public Characters in Your Game** (Page ${page + 1}/${totalPages})`,
    components,
  };
}

export { rebuildListCharactersResponse };
