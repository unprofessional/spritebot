// src/handlers/modal_handlers/character_creation_modals.ts

import type { ModalSubmitInteraction } from 'discord.js';

import { getUserDefinedFields } from '../../services/character.service';
import {
  getRemainingRequiredFields,
  getTempCharacterData,
  upsertTempCharacterField,
} from '../../services/character_draft.service';
import { getGame, getStatTemplates } from '../../services/game.service';
import { getOrCreatePlayer } from '../../services/player.service';
import { rebuildCreateCharacterResponse } from '../../utils/rebuild_create_character_response';

import type { Game } from '../../types/game';
import type { StatTemplate } from '../../types/stat_template';

async function processCharacterFieldModal(
  interaction: ModalSubmitInteraction,
  fieldKey: string,
  label: string,
  value: string | null,
  fieldType: string | null,
): Promise<void> {
  const userId = interaction.user.id;
  const draft = await getTempCharacterData(userId);

  console.log('🧾 Retrieved draft for processCharacterFieldModal:', draft);

  if (!draft || !draft.game_id) {
    console.warn('⚠️ Draft missing game_id');
    await interaction.reply({
      content: '⚠️ Your draft session is invalid or expired.',
      ephemeral: true,
    });
    return;
  }

  const { game_id: gameId } = draft;
  const statTemplates = (await getStatTemplates(gameId)) as StatTemplate[];

  if (fieldType === 'count') {
    const maxRaw = interaction.fields.getTextInputValue(`${fieldKey}:max`)?.trim();
    const currentRaw = interaction.fields.getTextInputValue(`${fieldKey}:current`)?.trim();

    const max = parseInt(maxRaw, 10);
    const current = currentRaw ? parseInt(currentRaw, 10) : max;

    if (isNaN(max)) {
      console.warn('⚠️ Max value not a number:', maxRaw);
      await interaction.reply({
        content: '⚠️ Max value must be a number.',
        ephemeral: true,
      });
      return;
    }

    const meta = {
      current: isNaN(current) ? max : current,
      max,
    };

    await upsertTempCharacterField(userId, fieldKey, null, gameId, meta);
    console.log(`📥 Saved count field: ${fieldKey} = ${meta.current}/${max}`);
  } else {
    await upsertTempCharacterField(userId, fieldKey, value, gameId);
    console.log(`📥 Saved field: ${fieldKey} = ${value}`);
  }

  const updatedDraft = await getTempCharacterData(userId);
  const userFields = await getUserDefinedFields(userId);
  const game = (await getGame({ id: gameId })) as Game;
  const remaining = await getRemainingRequiredFields(userId);

  const response = rebuildCreateCharacterResponse(
    game,
    statTemplates,
    userFields,
    remaining,
    updatedDraft?.data ?? {},
  );

  const contentPrefix =
    remaining.length === 0
      ? `✅ All required fields are filled! Submit when ready:\n\n`
      : `✅ Saved **${label}**. Choose next field:\n\n`;

  try {
    await interaction.deferUpdate();
    await interaction.editReply({
      ...response,
      content: contentPrefix + (response.content || ''),
    });
  } catch (err) {
    console.error('❌ Failed to update ephemeral response:', err);
    await interaction.followUp({
      content: '⚠️ Failed to update your character builder. Please rerun `/create-character`.',
      ephemeral: true,
    });
  }
}

export async function handle(interaction: ModalSubmitInteraction): Promise<void> {
  const { customId, user, guildId } = interaction;

  const prefixes = ['createDraftCharacterField:', 'setCharacterField:'];
  const prefix = prefixes.find((p) => customId.startsWith(p));
  if (!prefix) return;

  const combined = customId.slice(prefix.length);
  const [fieldKey, labelRaw = fieldKey, fieldType = null] = combined.split('|');
  const label = labelRaw || fieldKey;

  console.log(`[${prefix}] fieldKey:`, fieldKey);
  console.log(`[${prefix}] label:`, label);
  console.log(`[${prefix}] fieldType:`, fieldType);

  if (!fieldKey || !fieldKey.includes(':')) {
    await interaction.reply({
      content: '⚠️ Invalid field key. Please restart character creation.',
      ephemeral: true,
    });
    return;
  }

  try {
    const userId = user.id;
    const draft = await getTempCharacterData(userId);
    console.log(`🧾 Draft state before processing:`, draft);

    if (!draft?.game_id) {
      await interaction.reply({
        content: '⚠️ Your draft session is invalid or expired.',
        ephemeral: true,
      });
      return;
    }

    let value: string | null = null;
    if (fieldType !== 'count') {
      value = interaction.fields.getTextInputValue(fieldKey)?.trim() ?? null;
      if (!value) {
        console.warn('⚠️ No value entered for field:', fieldKey);
        await interaction.reply({
          content: '⚠️ No value was entered.',
          ephemeral: true,
        });
        return;
      }
    }

    await getOrCreatePlayer(userId, guildId ?? 'unknown');
    await processCharacterFieldModal(interaction, fieldKey, label, value, fieldType);
  } catch (err) {
    console.error(`[${prefix}] Error processing modal for "${fieldKey}":`, err);
    await interaction.reply({
      content: `❌ Failed to process field \`${fieldKey}\`. Please restart character creation.`,
      ephemeral: true,
    });
  }
}
