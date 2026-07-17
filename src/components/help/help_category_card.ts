import { EmbedBuilder } from 'discord.js';

import type { FeatureKey } from '../../access/features';
import { buildNavigation } from './help_category_menu';
import { getVisibleHelpCategory, type HelpCategoryId, type HelpRole } from './help_content';

export function build(role: HelpRole, categoryId: string, features: ReadonlySet<FeatureKey>) {
  const category = getVisibleHelpCategory(role, categoryId, features);
  if (!category) return null;

  const body = category.walkthrough
    ? category.walkthrough(features)
    : category.commands
        ?.map((entry) => {
          const heading = entry.command.startsWith('/')
            ? `\`${entry.command}\``
            : `**${entry.command}**`;
          return `${heading} — ${entry.description}${entry.note ? `\n${entry.note}` : ''}`;
        })
        .join('\n\n');

  const embed = new EmbedBuilder()
    .setTitle(`${category.emoji} ${category.label}`)
    .setDescription(body || 'No help is available for this topic yet.')
    .setColor(role === 'player' ? 0x5865f2 : 0x57f287);

  return {
    embeds: [embed],
    components: buildNavigation(role, features, category.id as HelpCategoryId),
    ephemeral: true as const,
  };
}
