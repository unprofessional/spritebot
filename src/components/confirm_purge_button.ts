// src/components/confirm_purge_button.ts

import { ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';
import {
  purgeSafeOrphans,
  type HousekeepingPurgeResult,
} from '../services/admin_housekeeping.service';

const id = 'confirmPurgeOrphans';
const OWNER_IDS = new Set<string>([(process.env.OWNER_DISCORD_ID ?? '').trim()].filter(Boolean));
const OPS_GUILD_ID = process.env.DEV_GUILD_ID ?? '';

function build(requestedBy: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${requestedBy}`)
    .setLabel('Confirm Purge')
    .setStyle(ButtonStyle.Danger);
}

function formatResults(results: HousekeepingPurgeResult[]): string {
  const total = results.reduce((sum, result) => sum + result.count, 0);
  const lines = results.map((result) => `• ${result.label}: **${result.count}**`);

  return [`🧹 Purge complete. Permanently deleted **${total}** row(s).`, ...lines].join('\n');
}

async function handle(interaction: ButtonInteraction): Promise<void> {
  const [, requestedBy] = interaction.customId.split(':');

  if (interaction.guildId !== OPS_GUILD_ID) {
    await interaction.reply({
      content: '⛔ Purge confirmation is only available in the ops guild.',
      ephemeral: true,
    });
    return;
  }

  if (!OWNER_IDS.has(interaction.user.id) || interaction.user.id !== requestedBy) {
    await interaction.reply({
      content: '⛔ Only the bot owner who requested this purge preview can confirm it.',
      ephemeral: true,
    });
    return;
  }

  try {
    const results = await purgeSafeOrphans();
    await interaction.update({
      content: formatResults(results),
      embeds: [],
      components: [],
    });
  } catch (err) {
    console.error('Failed to purge safe orphan rows:', err);
    await interaction.reply({
      content: '❌ Something went wrong while purging safe orphan rows.',
      ephemeral: true,
    });
  }
}

export { build, handle, id };
