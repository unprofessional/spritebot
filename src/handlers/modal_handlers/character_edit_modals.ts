// src/handlers/modal_handlers/character_edit_modals.ts

import type { ModalSubmitInteraction } from 'discord.js';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';

import {
  getCharacterWithStats,
  updateStat,
  updateCharacterMeta,
  updateStatMetaField,
} from '../../services/character.service';
import { isActiveCharacter } from '../../utils/is_active_character';
import { build as buildCharacterCard } from '../../components/view_character_card';

export async function handle(
  interaction: ModalSubmitInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  try {
    const { customId } = interaction;

    // === Edit GAME Stat ===
    if (customId.startsWith('editStatModal:')) {
      const [, characterId, fieldType, fieldKey] = customId.split(':');

      if (fieldType === 'count') {
        const maxRaw = interaction.fields.getTextInputValue(`${fieldKey}:max`)?.trim() ?? '';
        const currentRaw =
          interaction.fields.getTextInputValue(`${fieldKey}:current`)?.trim() ?? '';

        const max = parseInt(maxRaw, 10);
        const current = currentRaw ? parseInt(currentRaw, 10) : max;

        if (isNaN(max)) {
          await responder.respond({
            content: '⚠️ Invalid MAX value entered.',
            ephemeral: true,
          });
          return;
        }

        await updateStatMetaField(characterId, fieldKey, 'max', max);
        await updateStatMetaField(characterId, fieldKey, 'current', isNaN(current) ? max : current);
      } else {
        const newValue = interaction.fields.getTextInputValue(fieldKey)?.trim() ?? '';
        if (!newValue) {
          await responder.respond({
            content: '⚠️ Invalid stat update.',
            ephemeral: true,
          });
          return;
        }
        await updateStat(characterId, fieldKey, newValue);
      }

      const updated = await getCharacterWithStats(characterId);
      if (!updated) {
        await responder.respond({ content: '⚠️ Could not load updated character data.' });
        return;
      }

      const isSelf = await isActiveCharacter(
        interaction.user.id,
        interaction.guildId ?? '',
        characterId,
      );
      const view = buildCharacterCard(updated, isSelf);

      await responder.respond({ ...view, content: null });
      return;
    }

    // === Edit CORE Field ===
    if (customId.startsWith('setCharacterField:') || customId.startsWith('editCharacterField:')) {
      const parts = customId.split(':');
      const characterId = parts[1];
      const fullKeyWithLabel = parts.slice(2).join(':');
      const [fieldKey] = fullKeyWithLabel.split('|');
      const [, coreField] = fieldKey.includes(':') ? fieldKey.split(':') : [null, fieldKey];

      const newValue =
        interaction.fields.getTextInputValue(fieldKey)?.trim() ??
        interaction.fields.getTextInputValue(coreField)?.trim() ??
        '';

      if (!coreField || !newValue) {
        await responder.respond({
          content: '⚠️ Invalid core field update.',
          ephemeral: true,
        });
        return;
      }

      await updateCharacterMeta(characterId, { [coreField]: newValue });

      const updated = await getCharacterWithStats(characterId);
      if (!updated) {
        await responder.respond({ content: '⚠️ Could not load updated character.' });
        return;
      }

      const isSelf = await isActiveCharacter(
        interaction.user.id,
        interaction.guildId ?? '',
        characterId,
      );
      const view = buildCharacterCard(updated, isSelf);

      await responder.respond({ ...view, content: null });
      return;
    }

    // === Edit Full Metadata ===
    if (customId.startsWith('editCharacterModal:')) {
      const [, characterId] = customId.split(':');

      const name = interaction.fields.getTextInputValue('name')?.trim() ?? '';
      const className = interaction.fields.getTextInputValue('class')?.trim();
      const levelRaw = interaction.fields.getTextInputValue('level') ?? '';
      const level = parseInt(levelRaw, 10);

      if (!name || !className || isNaN(level)) {
        await responder.respond({
          content: '⚠️ Invalid input. Please provide valid name, class, and level.',
          ephemeral: true,
        });
        return;
      }

      // Currently only name is supported in updateCharacterMeta
      await updateCharacterMeta(characterId, { name });

      const updated = await getCharacterWithStats(characterId);
      if (!updated) {
        await responder.respond({ content: '⚠️ Could not load updated character.' });
        return;
      }

      const isSelf = await isActiveCharacter(
        interaction.user.id,
        interaction.guildId ?? '',
        characterId,
      );
      const view = buildCharacterCard(updated, isSelf);

      await responder.respond({
        ...view,
        content: `📝 Character **${name}** updated successfully.`,
      });
      return;
    }

    await responder.respond({
      content: '❓ Unrecognized modal submission.',
      ephemeral: true,
    });
  } catch (err) {
    console.error('[character_edit_modals] Uncaught exception in modal handler:', err);
    await responder.respond({
      content: '❌ An unexpected error occurred while processing your request.',
      ephemeral: true,
    });
  }
}
