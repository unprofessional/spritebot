import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';
import type { CharacterWithStats } from '../types/character';
import { formatTimeAgo } from '../utils/time_ago';
import { build as buildCalculateStatsButton } from './calculate_character_stats_button';
import { build as buildDeleteCharacterButton } from './delete_character_button';
import { build as buildEditCharacterStatsButton } from './edit_character_stats_button';
import { build as buildToggleCharacterVisibilityButton } from './toggle_character_visibility_button';
import { build as buildViewParagraphFieldsButton } from './view_paragraph_fields_button';

export function build(character: CharacterWithStats, isSelf = false) {
  console.log('🧪 view_character_card.build > isSelf:', isSelf);

  const parsedStats = parseCharacterStats(character.stats || []);
  const hasParagraphFields = parsedStats.paragraphFields.length > 0;

  const actionRows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (isSelf) {
    actionRows.push(buildActionRow(character));
  } else if (hasParagraphFields) {
    actionRows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        buildViewParagraphFieldsButton(character.id),
      ),
    );
  }

  return {
    embeds: [buildEmbed(character)],
    components: actionRows,
  };
}

function buildEmbed(character: CharacterWithStats) {
  const embed = new EmbedBuilder();

  if (character.avatar_url) {
    embed.setImage(character.avatar_url);
  }

  embed.setTitle(character.name || 'Unnamed Character');

  if (character.bio) {
    embed.setDescription(`_${character.bio}_`);
  }

  const parsedStats = parseCharacterStats(character.stats || []);

  for (const para of parsedStats.paragraphFields) {
    embed.addFields({
      name: `**${para.label}**`,
      value: para.value.length > 400 ? para.value.slice(0, 397) + '…' : para.value,
      inline: false,
    });
  }

  const displayStrings = parsedStats.gridFields.map(formatStatDisplay);
  for (let i = 0; i < displayStrings.length; i += 2) {
    const left = displayStrings[i] ?? '\u200B';
    const right = displayStrings[i + 1] ?? '\u200B';

    embed.addFields(
      { name: '\u200B', value: left, inline: true },
      { name: '\u200B', value: right, inline: true },
    );
  }

  const isPublic = (character.visibility || 'private').toLowerCase() === 'public';
  const pubLabel = isPublic ? '🌐 Published' : '🔒 Not Published';

  embed.addFields({
    name: 'Visibility',
    value: isPublic
      ? pubLabel
      : `${pubLabel}\n_Publishing your character allows other players to see it and may unlock in-game features._`,
    inline: true,
  });

  const created = character.created_at ?? new Date().toISOString();

  embed.setFooter({
    text: `Created on ${new Date(created).toLocaleDateString()} (${formatTimeAgo(created)})`,
  });

  return embed;
}

function buildActionRow(character: CharacterWithStats) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    buildEditCharacterStatsButton(character.id),
    buildCalculateStatsButton(character.id),
    buildViewParagraphFieldsButton(character.id),
    buildToggleCharacterVisibilityButton(character.id, character.visibility),
    buildDeleteCharacterButton(character.id),
  );
}

// Local type to replace all `any`
interface ParsedStat {
  label: string;
  value: string | null;
  current: number | null;
  max: number | null;
  type: string;
  sort_index: number;
}

function parseCharacterStats(stats: CharacterWithStats['stats']) {
  const statMap = new Map<string, ParsedStat>();

  for (const stat of stats) {
    const { label, value, meta = {}, field_type, template_id } = stat;
    const key = (label || template_id || '??').toUpperCase();
    if (!key) continue;

    const bucket: ParsedStat = {
      label: key,
      value: null,
      current: null,
      max: null,
      type: field_type,
      sort_index: stat.sort_index ?? (stat as any).template_sort_index ?? 999,
    };

    if (field_type === 'count') {
      bucket.max = meta.max ?? null;
      bucket.current = meta.current ?? meta.max ?? null;
    } else {
      bucket.value = value ?? null;
    }

    statMap.set(key, bucket);
  }

  const sorted = Array.from(statMap.values()).sort((a, b) => a.sort_index - b.sort_index);

  const paragraphFields: { label: string; value: string }[] = [];
  const gridFields: ParsedStat[] = [];

  for (const stat of sorted) {
    if (stat.type === 'paragraph') {
      if ((stat.value || '').trim()) {
        paragraphFields.push({ label: stat.label, value: stat.value!.trim() });
      }
    } else {
      gridFields.push(stat);
    }
  }

  return { paragraphFields, gridFields };
}

function formatStatDisplay(stat: ParsedStat): string {
  if (stat.type === 'count' && stat.max !== null) {
    return `**${stat.label}**: ${stat.current ?? stat.max} / ${stat.max}`;
  } else if (stat.value !== undefined && stat.value !== null && stat.value !== '') {
    return `**${stat.label}**: ${stat.value}`;
  } else {
    return `**${stat.label}**: _Not set_`;
  }
}
