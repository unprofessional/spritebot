import { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction } from 'discord.js';

import { getCharactersByGame, getCharacterWithStats } from '../services/character.service';
import {
  getCurrentGame,
  getCurrentCharacter,
  setCurrentCharacter,
} from '../services/player.service';
import { validateGameAccess } from '../utils/validate_game_access';
import { formatTimeAgo } from '../utils/time_ago';
import { isActiveCharacter } from '../utils/is_active_character';
import { build as buildCharacterCard } from './view_character_card';

export const id = 'switchCharacterDropdown';

interface CharacterOption {
  label: string;
  description: string;
  value: string;
  isActive: boolean;
}

export async function build(
  userId: string,
  guildId: string,
): Promise<
  | { content: string; ephemeral: true }
  | { content: string; components: ActionRowBuilder<StringSelectMenuBuilder>[]; ephemeral: true }
> {
  const currentGameId = await getCurrentGame(userId, guildId);
  if (!currentGameId) {
    return {
      content:
        "⚠️ You don't have an active game in this server. Use `/switch-game` or `/join-game` first.",
      ephemeral: true,
    };
  }

  const currentCharacterId = await getCurrentCharacter(userId, guildId);
  const allCharacters = await getCharactersByGame(currentGameId);
  const eligibleOptions: CharacterOption[] = [];

  for (const character of allCharacters) {
    const { valid } = await validateGameAccess({
      gameId: character.game_id,
      userId,
    });

    if (!valid) continue;

    const fullCharacter = await getCharacterWithStats(character.id);
    if (!fullCharacter) continue;

    const isActive = fullCharacter.id === currentCharacterId;

    const topStats = (fullCharacter.stats || [])
      .slice()
      .sort((a, b) => {
        const aOrder = typeof a.meta?.sort_order === 'number' ? a.meta.sort_order : 999;
        const bOrder = typeof b.meta?.sort_order === 'number' ? b.meta.sort_order : 999;
        return aOrder !== bOrder ? aOrder - bOrder : a.label.localeCompare(b.label);
      })
      .slice(0, 4)
      .map((s) => {
        if (s.field_type === 'count') {
          const current = s.meta?.current ?? '?';
          const max = s.meta?.max ?? '?';
          return `${s.label}: ${current} / ${max}`;
        } else {
          return `${s.label}: ${s.value}`;
        }
      });

    const visibilityBadge = fullCharacter.visibility === 'public' ? '✅ Public' : '🔒 Private';
    const createdAt = fullCharacter.created_at
      ? formatTimeAgo(fullCharacter.created_at)
      : 'unknown time';

    const baseLabel = `${fullCharacter.name} — ${createdAt} — ${visibilityBadge}`;

    const label = isActive ? `⭐ ${baseLabel} (ACTIVE)` : baseLabel;

    eligibleOptions.push({
      label: label.length > 100 ? label.slice(0, 97) + '…' : label,
      description: topStats.join(' • ').slice(0, 100) || 'No stats available',
      value: fullCharacter.id,
      isActive,
    });
  }

  if (!eligibleOptions.length) {
    return {
      content: '⚠️ You have no characters in published or accessible games.',
      ephemeral: true,
    };
  }

  eligibleOptions.sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder('Choose your character')
    .addOptions(
      eligibleOptions.map((opt) => ({
        label: opt.label,
        description: opt.description,
        value: opt.value,
      })),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

  return {
    content: '🎭 Choose your active character:',
    components: [row],
    ephemeral: true,
  };
}

export async function handle(interaction: StringSelectMenuInteraction): Promise<void> {
  const selected = interaction.values?.[0];
  const { user, guildId } = interaction;

  if (!selected) {
    await interaction.reply({
      content: '⚠️ No selection made.',
      ephemeral: true,
    });
    return;
  }

  try {
    if (!guildId) {
      await interaction.reply({
        content: '⚠️ This action must be used in a server.',
        ephemeral: true,
      });
      return;
    }

    await setCurrentCharacter(user.id, guildId, selected);
    const character = await getCharacterWithStats(selected);

    if (!character) {
      await interaction.reply({
        content: '⚠️ Could not find the selected character.',
        ephemeral: true,
      });
      return;
    }

    const isSelf = await isActiveCharacter(user.id, guildId, character.id);
    const view = buildCharacterCard(character, isSelf);

    await interaction.update({
      content: `✅ Switched to **${character.name}**!`,
      ...view,
    });
  } catch (err) {
    console.error('Error switching character:', err);
    await interaction.reply({
      content: '❌ Failed to switch character.',
      ephemeral: true,
    });
  }
}
