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

import type { CharacterDraft } from '../../types/character';
import type { Game } from '../../types/game';
import type { StatTemplate } from '../../types/stat_template';

async function processCharacterFieldModal(
  interaction: ModalSubmitInteraction,
  fieldKey: string,
  label: string,
  value: string | null,
): Promise<void> {
  const draft = (await getTempCharacterData(interaction.user.id)) as CharacterDraft | null;
  const gameId = draft?.game_id;

  if (!gameId) {
    await interaction.reply({
      content: '⚠️ Your draft session is invalid or expired.',
      ephemeral: true,
    });
    return;
  }

  const statTemplates = (await getStatTemplates(gameId)) as StatTemplate[];
  const matchingTemplate = statTemplates.find((t) => `game:${t.id}` === fieldKey);

  if (matchingTemplate?.field_type === 'count') {
    const maxRaw = interaction.fields.getTextInputValue(`${fieldKey}:max`)?.trim();
    const currentRaw = interaction.fields.getTextInputValue(`${fieldKey}:current`)?.trim();

    const max = parseInt(maxRaw, 10);
    const current = currentRaw ? parseInt(currentRaw, 10) : max;

    if (isNaN(max)) {
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

    await upsertTempCharacterField(interaction.user.id, fieldKey, null, gameId, meta);
  } else {
    await upsertTempCharacterField(interaction.user.id, fieldKey, value, gameId);
  }

  const updatedDraft = (await getTempCharacterData(interaction.user.id)) as CharacterDraft;
  const userFields = await getUserDefinedFields(interaction.user.id);
  const game = (await getGame({ id: gameId })) as Game;
  const remaining = await getRemainingRequiredFields(interaction.user.id);

  const response = rebuildCreateCharacterResponse(
    game,
    statTemplates,
    userFields,
    remaining,
    updatedDraft.data,
  );

  // ✅ Update the existing ephemeral message instead of sending a new one
  await interaction.deferUpdate();
  await interaction.editReply({
    ...response,
    content:
      remaining.length === 0
        ? `✅ All required fields are filled! Submit when ready:\n\n${response.content}`
        : `✅ Saved **${label}**. Choose next field:\n\n${response.content}`,
  });
}

export async function handle(interaction: ModalSubmitInteraction): Promise<void> {
  const { customId } = interaction;

  let prefix = '';
  if (customId.startsWith('createDraftCharacterField:')) {
    prefix = 'createDraftCharacterField:';
  } else if (customId.startsWith('setCharacterField:')) {
    prefix = 'setCharacterField:';
  }

  if (!prefix) return;

  const combined = customId.slice(prefix.length);
  const [fieldKey, labelRaw] = combined.split('|');
  const label = labelRaw || fieldKey;

  console.log(`[${prefix}] fieldKey:`, fieldKey);
  console.log(`[${prefix}] label:`, label);

  if (!fieldKey || !fieldKey.includes(':')) {
    await interaction.reply({
      content: '⚠️ Invalid field key. Please restart character creation.',
      ephemeral: true,
    });
    return;
  }

  try {
    const draft = (await getTempCharacterData(interaction.user.id)) as CharacterDraft | null;
    const gameId = draft?.game_id;

    if (!gameId) {
      await interaction.reply({
        content: '⚠️ Your draft session is invalid or expired.',
        ephemeral: true,
      });
      return;
    }

    const statTemplates = (await getStatTemplates(gameId)) as StatTemplate[];
    const matchingTemplate = statTemplates.find((t) => `game:${t.id}` === fieldKey);

    let value: string | null = null;
    if (matchingTemplate?.field_type !== 'count') {
      value = interaction.fields.getTextInputValue(fieldKey)?.trim() ?? null;
      if (!value) {
        await interaction.reply({
          content: '⚠️ No value was entered.',
          ephemeral: true,
        });
        return;
      }
    }

    await getOrCreatePlayer(interaction.user.id, interaction.guildId ?? 'unknown');
    await processCharacterFieldModal(interaction, fieldKey, label, value);
  } catch (err) {
    console.error(`[${prefix}] Error accessing field "${fieldKey}":`, err);
    await interaction.reply({
      content: `❌ Unable to find or parse field \`${fieldKey}\`. Please restart character creation.`,
      ephemeral: true,
    });
  }
}
