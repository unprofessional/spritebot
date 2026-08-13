import { ModalBuilder, StringSelectMenuInteraction } from 'discord.js';
import { discordCustomId } from '../../utils/discord_custom_id';

import { getCharacterWithStats } from '../../services/character.service';
import type { CharacterWithStats, CharacterStatWithLabel } from '../../types/character';
import { gatedPreparedComponentModalInteractionPolicy } from '../../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';
import { presentPreparedModal } from '../../discord/prepared_modal';
import { modalStringSelect, modalTextInput } from '../../utils/modal_components';

export const interactionPolicy = gatedPreparedComponentModalInteractionPolicy;

export async function handle(
  interaction: StringSelectMenuInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const { customId, values } = interaction;
  const [selected] = values;
  const [, statId] = selected.split(':');
  const [, characterId] = customId.split(':');

  const character: CharacterWithStats | null = await getCharacterWithStats(characterId);

  if (!character || !Array.isArray(character.stats)) {
    await responder.respond({
      content: '❌ Character or stat not found.',
      embeds: [],
      components: [],
    });
    return;
  }

  const stat: CharacterStatWithLabel | undefined = character.stats.find(
    (s: CharacterStatWithLabel) => s.template_id === statId,
  );

  if (!stat) {
    await responder.respond({
      content: '❌ Stat not found on character.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (customId.startsWith('adjustStatSelect:')) {
    const modal = new ModalBuilder()
      .setCustomId(discordCustomId(`adjustStatModal:${characterId}:${statId}`))
      .setTitle('Adjust Stat Value');

    modal.addLabelComponents(
      modalStringSelect({
        customId: 'deltaOperator',
        label: 'Operation',
        placeholder: 'Choose how to adjust the stat',
        options: [
          { label: 'Add (+)', value: '+' },
          { label: 'Subtract (-)', value: '-' },
          { label: 'Multiply (x)', value: '*' },
          { label: 'Divide (/)', value: '/' },
        ],
      }),
      modalTextInput({
        customId: 'deltaValue',
        label: 'Value to apply',
        placeholder: 'Enter a whole number',
      }),
    );

    await presentPreparedModal({ modal, responder, userId: interaction.user.id });
    return;
  }

  await responder.respond({
    content: '❌ Unknown stat adjustment selection.',
    ephemeral: true,
  });
}
