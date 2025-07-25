// src/components/view_game_stat_card.ts

import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';

import type { Game } from '../types/game';
import type { StatTemplate } from '../types/stat_template';

import { build as buildDefineStatsButton } from './define_stats_button';
import { build as buildDeleteStatsButton } from './delete_stat_button';
import { build as buildEditGameStatsButton } from './edit_game_stat_button';
import { build as buildTogglePublishButton } from './toggle_publish_button';

interface GameStatCard {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * Builds a stat template embed + button row for the given game.
 */
function build(
  game: Game,
  fields: StatTemplate[] = [],
  highlightLabel: string | null = null,
): GameStatCard {
  return {
    embeds: [buildEmbed(fields, game, highlightLabel)],
    components: [buildButtonRow(game.id, fields)],
  };
}

function buildEmbed(
  fields: StatTemplate[],
  game: Game,
  highlightLabel: string | null = null,
): EmbedBuilder {
  const fieldLines = fields.map((f) => {
    const isNew = highlightLabel && f.label?.toLowerCase() === highlightLabel.toLowerCase();

    const icon = f.field_type === 'paragraph' ? '📝' : '🔹';
    const defaultStr = f.default_value ? ` _(default: ${f.default_value})_` : '';
    const labelWithType = `${f.label} \`${f.field_type}\``;

    return `${icon} ${isNew ? '**🆕 ' : '**'}${labelWithType}**${defaultStr}`;
  });

  return new EmbedBuilder()
    .setTitle('📋 GAME Character Stats')
    .setDescription(
      [
        fieldLines.length ? fieldLines.join('\n') : '*No stats defined yet.*',
        '',
        '**Game Visibility**',
        game.is_public
          ? '`Public ✅` — Players can use `/join-game`'
          : '`Draft ❌` — Not yet visible to players',
      ].join('\n'),
    )
    .setColor(game.is_public ? 0x00c851 : 0xffbb33);
}

function buildButtonRow(
  gameId: string,
  fields: StatTemplate[] = [],
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buildDefineStatsButton(gameId));

  if (fields.length > 0) {
    row.addComponents(buildEditGameStatsButton(gameId), buildDeleteStatsButton(gameId));
  }

  row.addComponents(buildTogglePublishButton(gameId));

  return row;
}

export { build };
