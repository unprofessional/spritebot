// src/utils/rebuild_create_game_response.ts

import type { ActionRowBuilder, EmbedBuilder } from 'discord.js';
import type { Game } from '../types/game';
import type { StatTemplate } from '../types/stat_template';

import { build as buildGameStatCard } from '../components/view_game_stat_card';

/**
 * Builds the top-level instructional message for the game setup screen.
 */
function buildGameSetupMessage(
  game: Game,
  context: 'create' | 'view' = 'create',
  statTemplates: StatTemplate[] = [],
): string {
  const lines: string[] = [];

  lines.push(`# **${game.name}**`);
  if (context === 'create') {
    lines.push(`✅ Created game **${game.name}** and set it as your active campaign.`);
  }

  lines.push('');

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
  if (context === 'create') {
    lines.push(
      `Use the buttons below to define your required game-specific stat fields or to publish the game.`,
    );
    lines.push(`_You do **not** need to redefine system fields._`);
  } else {
    lines.push(`Use the buttons below to manage stat fields or update game info.`);
  }

  return lines.join('\n');
}

/**
 * Reconstructs the original /create-game or /view-game message response.
 */
function rebuildCreateGameResponse(
  game: Game,
  statTemplates: StatTemplate[],
  highlightLabel: string | null = null,
  context: 'create' | 'view' = 'create',
  viewerUserId: string | null = null,
): {
  content: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder[];
} {
  const content = buildGameSetupMessage(game, context, statTemplates);

  let embeds: EmbedBuilder[] = [];
  let components: ActionRowBuilder[] = [];

  if (!viewerUserId || game.created_by === viewerUserId) {
    const card = buildGameStatCard(game, statTemplates, highlightLabel);
    embeds = card.embeds;
    components = card.components;
  }

  return {
    content,
    embeds,
    components,
  };
}

export { rebuildCreateGameResponse };
