// src/components/submit_character_button.ts

import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';

import { getCharacterWithStats } from '../services/character.service';
import {
  finalizeCharacterCreation,
  getTempCharacterData,
  isDraftComplete,
} from '../services/character_draft.service';
import { setCurrentCharacter } from '../services/player.service';
import { isActiveCharacter } from '../utils/is_active_character';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import { build as buildCharacterCard } from './view_character_card';

const id = 'submitNewCharacter';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

function build(isDisabled = false): ActionRowBuilder<ButtonBuilder> {
  const button = new ButtonBuilder()
    .setCustomId(id)
    .setLabel('✅ Submit Character')
    .setStyle(ButtonStyle.Success)
    .setDisabled(isDisabled);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const { user, guildId } = interaction;
  const userId = user.id;

  try {
    const complete = await isDraftComplete(userId);
    console.log(`[submit_character_button] Draft completeness for user ${userId}: ${complete}`);

    if (!complete) {
      await responder.respond({
        content: '⚠️ Your character is missing required fields. Please finish filling them out.',
        ephemeral: true,
      });
      return;
    }

    const draft = await getTempCharacterData(userId);
    if (!draft) {
      await responder.respond({
        content: '❌ Draft data missing. Please restart character creation.',
        ephemeral: true,
      });
      return;
    }

    console.log(`[submit_character_button] Draft data for user ${userId}:`, draft);

    const character = await finalizeCharacterCreation(userId, draft);
    console.log(
      `[submit_character_button] Finalized character: ${character.name} (${character.id})`,
    );

    await setCurrentCharacter(userId, guildId!, character.id);
    console.log(
      `[submit_character_button] Set ${character.name} (${character.id}) as active character for ${userId} in ${guildId}`,
    );

    const fullCharacter = await getCharacterWithStats(character.id);
    if (!fullCharacter) {
      await responder.respond({
        content: '❌ Failed to load character details after creation.',
        ephemeral: true,
      });
      return;
    }

    const isSelf = await isActiveCharacter(userId, guildId!, character.id);
    const view = buildCharacterCard(fullCharacter, isSelf);
    const nudge = buildNudge(
      {
        userId,
        guildId: guildId!,
        gameId: character.game_id,
        hasActiveCharacter: true,
        // Submission does not currently know channel IC state, so always nudge toward /ic.
        isInIC: false,
      },
      'submit-character',
    );

    await responder.respond({
      content: appendNudge(`✅ Character **${character.name}** created successfully!`, nudge),
      embeds: view.embeds,
      components: view.components,
    });
  } catch (err) {
    console.error('[submit_character_button] Failed to submit character:', err);
    await responder.respond({
      content: '❌ Failed to submit character. Please try again.',
      ephemeral: true,
    });
  }
}

export { build, handle, id, interactionPolicy };
