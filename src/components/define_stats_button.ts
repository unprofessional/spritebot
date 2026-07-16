// src/components/define_stats_button.ts

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
  type ButtonInteraction,
} from 'discord.js';

import { getGame } from '../services/game.service';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import type { Game } from '../types/game';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';
import { build as buildCancelButton } from './finish_stat_setup_button';
import { build as buildStatTypeDropdown } from './stat_type_selector';

const id = 'defineStats';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

function build(gameId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${gameId}`)
    .setLabel('➕ Add Another Stat')
    .setStyle(ButtonStyle.Primary);
}

async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [, gameId] = interaction.customId.split(':');
  const game = (await getGame({ id: gameId })) as Game | null;

  if (!game || game.created_by !== interaction.user.id) {
    await responder.respond({
      content: '⚠️ Only the GM can define new stat fields.',
      ephemeral: true,
    });
    return;
  }

  const dropdownRow = buildStatTypeDropdown(gameId);
  const cancelBtn = new ButtonBuilder(buildCancelButton(gameId));
  const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(cancelBtn);
  const nudge = buildNudge(
    {
      userId: interaction.user.id,
      guildId: interaction.guildId ?? '',
      gameId,
      isGM: true,
      gameIsPublished: game.is_public,
    },
    'define-stat',
  );

  await responder.respond({
    content: appendNudge(
      [
        `## Define a new GAME stat field`,
        ``,
        `### Choose the *type* of stat you want to define.`,
        `⚠️ **Once created, the stat type CANNOT be changed.**`,
        `If you make a mistake, you must delete the stat and recreate it with the correct type.`,
        ``,
        `### Stat Types & Examples:`,
        ``,
        `🔢 **Number** — a single value (no max/current):`,
        `• Level, Gold, XP, Strength, Agility, Reputation, Kills, Karma`,
        ``,
        `🔁 **Count** — tracks both max and current value:`,
        `• HP, MP, Mana, FP, Charges, Ammo, Sanity`,
        ``,
        `💬 **Text (one-line)** — short string inputs:`,
        `• Race, Class, Allegiance, Faction`,
        ``,
        `📝 **Text (multi-line)** — paragraph-style notes:`,
        `• Personality, History, Abilities, Quirks`,
        `_(Remember: every character already has a built-in BIO field.)_`,
        ``,
        `Select a stat type from the dropdown below.`,
      ].join('\n'),
      nudge,
    ),
    components: [dropdownRow, cancelRow],
    embeds: [] as APIEmbed[],
  });
}

export { build, handle, id, interactionPolicy };
