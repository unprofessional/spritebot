// src/commands/create-character.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, CacheType } from 'discord.js';

import { getOrCreatePlayer, getCurrentGame } from '../services/player.service';
import { getGame, getStatTemplates } from '../services/game.service';
import { getUserDefinedFields } from '../services/character.service';
import { initDraft, getTempCharacterData } from '../services/character_draft.service';
import { rebuildCreateCharacterResponse } from '../utils/rebuild_create_character_response';

import type { StatTemplate } from '../types/stat_template';
import type { UserDefinedField } from '../types/character';

interface LabeledField {
  name: string;
  label: string;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('create-character')
    .setDescription('Create a character for your current game.'),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    if (!guildId) {
      return interaction.reply({
        content: '⚠️ You must use this command in a server.',
        ephemeral: true,
      });
    }

    await getOrCreatePlayer(userId, guildId);
    const gameId = await getCurrentGame(userId, guildId);

    if (!gameId) {
      return interaction.reply({
        content: '⚠️ You haven’t joined a game yet. Use `/join-game` to select one.',
        ephemeral: true,
      });
    }

    const game = await getGame({ id: gameId });
    if (!game) {
      return interaction.reply({
        content: '⚠️ Your currently joined game no longer exists.',
        ephemeral: true,
      });
    }

    if (!game.is_public && game.created_by !== userId) {
      return interaction.reply({
        content:
          '⚠️ This game is no longer public. You must ask the GM to republish it or invite you.',
        ephemeral: true,
      });
    }

    const statTemplates = (await getStatTemplates(gameId)) as StatTemplate[];
    const userFields = (await getUserDefinedFields(userId)) as UserDefinedField[];

    if (!statTemplates.length) {
      return interaction.reply({
        content: '⚠️ This game has no stat fields defined yet. Ask the GM to set them up.',
        ephemeral: true,
      });
    }

    const existingDraft = await getTempCharacterData(userId);
    const draft = initDraft(userId);
    if (!draft) {
      return interaction.reply({
        content: '⚠️ Failed to initialize character draft.',
        ephemeral: true,
      });
    }

    draft.game_id = gameId;

    console.log(`🧾 Draft initialized for user ${userId} with game_id: ${gameId}`);

    const coreFields: LabeledField[] = [
      { name: 'core:name', label: '[CORE] Name' },
      { name: 'core:bio', label: '[CORE] Bio' },
      { name: 'core:avatar_url', label: '[CORE] Avatar URL' },
    ];

    const gameFields: LabeledField[] = statTemplates.map((f) => ({
      name: `game:${f.id}`,
      label: `[GAME] ${f.label || f.id}`,
    }));

    const userFieldsFormatted: LabeledField[] = userFields
      .filter((f): f is UserDefinedField => typeof f?.name === 'string')
      .map((f) => ({
        name: `user:${f.name}`,
        label: `[USER] ${f.label || f.name}`,
      }));

    const allFields: LabeledField[] = [...coreFields, ...gameFields, ...userFieldsFormatted];

    const safeFields = allFields.filter(
      (f): f is LabeledField =>
        typeof f.label === 'string' &&
        typeof f.name === 'string' &&
        f.label.trim().length > 0 &&
        f.name.trim().length > 0 &&
        f.name.includes(':'),
    );

    if (!safeFields.length) {
      return interaction.reply({
        content: '⚠️ No valid fields found to show in the dropdown.',
        ephemeral: true,
      });
    }

    const hydratedDraft = await getTempCharacterData(userId);
    const response = rebuildCreateCharacterResponse(
      game,
      statTemplates,
      userFields,
      safeFields,
      hydratedDraft ?? undefined,
    );

    return await interaction.reply({
      ...response,
      content: existingDraft
        ? `⚠️ Resumed your previous draft!\nContinue filling in the fields below.\n\n${response.content || ''}`
        : response.content,
      ephemeral: true,
    });
  },
};
