// src/components/view_game_card.ts

import { EmbedBuilder, ActionRowBuilder, MessageActionRowComponentBuilder } from 'discord.js';

import type { Game } from '../types/game';
import type { StatTemplate } from '../types/stat_template';

import { build as buildDefineStats } from './define_stats_button';
import { build as buildDeleteStats } from './delete_stat_button';
import { build as buildEditGameStats } from './edit_game_stat_button';
import { build as buildToggleVisibility } from './toggle_publish_button';

interface ViewGameCardResponse {
  content: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

function build(
  game: Game,
  statTemplates: StatTemplate[] = [],
  viewerUserId: string | null = null,
): ViewGameCardResponse {
  const isGM = !viewerUserId || game.created_by === viewerUserId;

  const content = buildContent(game, statTemplates, isGM);
  const embed = buildEmbed(game, statTemplates);
  const components = isGM ? [buildButtons(game.id, statTemplates)] : [];

  return {
    content,
    embeds: [embed],
    components,
  };
}

function buildContent(game: Game, statTemplates: StatTemplate[], isGM: boolean): string {
  const lines: string[] = [`# **${game.name}**`];

  if (game.description?.trim()) {
    const desc = game.description.trim().slice(0, 200);
    lines.push(`> ${desc}${game.description.length > 200 ? '…' : ''}`);
  }

  lines.push('');
  lines.push(`🟦 **SYSTEM Character Fields** (always included):`);
  lines.push(`- Name`);
  lines.push(`- Avatar URL`);
  lines.push(`- Bio`);

  if (statTemplates.length === 0) {
    lines.push('');
    lines.push(`🟨 **Game Fields** (you define these)`);
    lines.push(`- Ex: HP, Strength, Skills, etc.`);
  }

  lines.push('');
  lines.push(
    isGM
      ? `Use the buttons below to manage stat fields or update game info.`
      : `Ask your Game Master to edit stats or publish this game.`,
  );

  return lines.join('\n');
}

function buildEmbed(
  game: Game,
  fields: StatTemplate[],
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

function buildButtons(
  gameId: string,
  statTemplates: StatTemplate[] = [],
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    buildDefineStats(gameId),
  );

  if (statTemplates.length > 0) {
    row.addComponents(buildEditGameStats(gameId), buildDeleteStats(gameId));
  }

  row.addComponents(buildToggleVisibility(gameId));

  return row;
}

export { build };
