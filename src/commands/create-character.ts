// src/commands/create-character.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, CacheType } from 'discord.js';

import { getOrCreatePlayer, getCurrentGame } from '../services/player.service';
import { getGame, getStatTemplates } from '../services/game.service';
import { getUserDefinedFields } from '../services/character.service';
import {
  getRemainingRequiredFields,
  initDraft,
  getTempCharacterData,
} from '../services/character_draft.service';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';
import { rebuildCreateCharacterResponse } from '../utils/rebuild_create_character_response';
import { applyCountStatDefaultsToDraft } from '../utils/count_stat_defaults';

import type { StatTemplate } from '../types/stat_template';
import type { UserDefinedField } from '../types/character';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('create-character')
    .setDescription('Create a character for your current game.'),

  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,

  async execute(
    interaction: ChatInputCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    if (!guildId) {
      return responder.respond({
        content: '⚠️ You must use this command in a server.',
        ephemeral: true,
      });
    }

    await getOrCreatePlayer(userId, guildId);
    const gameId = await getCurrentGame(userId, guildId);

    if (!gameId) {
      return responder.respond({
        content: appendNudge(
          '⚠️ You haven’t joined a game yet.',
          buildNudge({ userId, guildId }, 'create-character-no-game'),
        ),
        ephemeral: true,
      });
    }

    const game = await getGame({ id: gameId });
    if (!game) {
      return responder.respond({
        content: '⚠️ Your currently joined game no longer exists.',
        ephemeral: true,
      });
    }

    if (!game.is_public && game.created_by !== userId) {
      return responder.respond({
        content:
          '⚠️ This game is no longer public. You must ask the GM to republish it or invite you.',
        ephemeral: true,
      });
    }

    const statTemplates = (await getStatTemplates(gameId)) as StatTemplate[];
    const userFields = (await getUserDefinedFields(userId)) as UserDefinedField[];

    if (!statTemplates.length) {
      return responder.respond({
        content: '⚠️ This game has no stat fields defined yet. Ask the GM to set them up.',
        ephemeral: true,
      });
    }

    const existingDraft = await getTempCharacterData(userId);
    const draft = initDraft(userId);
    if (!draft) {
      return responder.respond({
        content: '⚠️ Failed to initialize character draft.',
        ephemeral: true,
      });
    }

    draft.game_id = gameId;
    applyCountStatDefaultsToDraft(draft.data, statTemplates);
    console.log(`🧾 Draft initialized for user ${userId} with game_id: ${gameId}`);

    const hydratedDraft = await getTempCharacterData(userId);
    const draftData: Record<string, unknown> = hydratedDraft?.data ?? {};
    const requiredFieldsRemaining = await getRemainingRequiredFields(userId);
    const response = rebuildCreateCharacterResponse(
      game,
      statTemplates,
      userFields,
      requiredFieldsRemaining,
      draftData,
    );

    // ✅ Send ephemeral builder
    await responder.respond({
      ...response,
      content: existingDraft
        ? `⚠️ Resumed your previous draft!\nContinue filling in the fields below.\n\n${response.content || ''}`
        : response.content,
      ephemeral: true,
    });
  },
};
