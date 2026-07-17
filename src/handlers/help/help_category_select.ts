import type { StringSelectMenuInteraction } from 'discord.js';

import { AUTHORIZATION_UNAVAILABLE_MSG, NEED_GUILD_MSG } from '../../access/guards';
import { build as buildCategoryCard } from '../../components/help/help_category_card';
import { isHelpRole } from '../../components/help/help_content';
import type { InteractionDispatchPolicy } from '../../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';
import { getHelpFeatures } from '../../services/help.service';

export const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

export async function handle(
  interaction: StringSelectMenuInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const role = interaction.customId.split(':')[2];
  const categoryId = interaction.values[0];
  if (!role || !isHelpRole(role) || !categoryId) {
    await responder.respond({ content: '❌ Unknown help topic.', components: [] });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await responder.respond({ content: NEED_GUILD_MSG, components: [] });
    return;
  }

  const result = await getHelpFeatures(guildId);
  if (!result.ok) {
    await responder.respond({ content: AUTHORIZATION_UNAVAILABLE_MSG, components: [] });
    return;
  }

  const card = buildCategoryCard(role, categoryId, result.features);
  if (!card) {
    await responder.respond({
      content: 'That help topic is not available for this server.',
      components: [],
    });
    return;
  }

  await responder.respond({ ...card });
}
