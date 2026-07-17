import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';

import type { FeatureKey } from '../../access/features';
import { getVisibleHelpCategories, type HelpCategoryId, type HelpRole } from './help_content';

export function build(role: HelpRole, features: ReadonlySet<FeatureKey>) {
  const embed = new EmbedBuilder()
    .setTitle(role === 'player' ? '🎮 Player Help' : '🛡️ GM / Server Admin Help')
    .setDescription('Choose a topic below. You can browse as many as you like.')
    .setColor(role === 'player' ? 0x5865f2 : 0x57f287);

  return {
    embeds: [embed],
    components: buildNavigation(role, features),
    ephemeral: true as const,
  };
}

export function buildNavigation(
  role: HelpRole,
  features: ReadonlySet<FeatureKey>,
  selected?: HelpCategoryId,
) {
  const categories = getVisibleHelpCategories(role, features);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`help:category:${role}`)
    .setPlaceholder('Choose a help topic')
    .addOptions(
      categories.map((category) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(category.label)
          .setEmoji(category.emoji)
          .setDescription(category.description.slice(0, 100))
          .setValue(category.id)
          .setDefault(category.id === selected),
      ),
    );

  const categoryRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('help:back')
      .setLabel('← Back to roles')
      .setStyle(ButtonStyle.Secondary),
  );
  return [categoryRow, backRow];
}
