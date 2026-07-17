import type { ButtonInteraction } from 'discord.js';

import { AUTHORIZATION_UNAVAILABLE_MSG, NEED_GUILD_MSG } from '../../access/guards';
import { build as buildCategoryMenu } from '../../components/help/help_category_menu';
import { isHelpRole } from '../../components/help/help_content';
import { build as buildLandingCard } from '../../components/help/help_landing_card';
import type { InteractionDispatchPolicy } from '../../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';
import { getHelpFeatures } from '../../services/help.service';

export const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

export async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  if (interaction.customId === 'help:back') {
    await responder.respond({ ...buildLandingCard() });
    return;
  }

  const role = interaction.customId.split(':')[2];
  if (!role || !isHelpRole(role)) {
    await responder.respond({ content: '❌ Unknown help role.', components: [] });
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

  await responder.respond({ ...buildCategoryMenu(role, result.features) });
}
