// src/commands/admin.ts

import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { handleAdminCharacters } from '../handlers/admin_characters.handler';
import { handleAdminGames } from '../handlers/admin_games.handler';
import { handleAdminGlobalStats } from '../handlers/admin_global_stats.handler';
import { handleAdminOrphans, handleAdminOrphansPurge } from '../handlers/admin_orphans.handler';
import { handleAdminRestoreCharacter } from '../handlers/admin_restore.handler';
import { userOwnsGame, userOwnsGameInGuild } from '../services/admin_housekeeping.service';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

const OWNER_IDS = new Set<string>([(process.env.OWNER_DISCORD_ID ?? '').trim()].filter(Boolean));
const OPS_GUILD_ID = process.env.DEV_GUILD_ID ?? '';

export const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('SPRITEbot admin housekeeping tools')
  .addSubcommand((subcommand) =>
    subcommand.setName('orphans').setDescription('Show a read-only orphan and stale-data report'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('orphans-purge')
      .setDescription('Preview and confirm permanent cleanup of safe orphan rows'),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('games').setDescription('Audit games in this server'),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('global-stats').setDescription('Show global SPRITEbot usage stats'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('characters')
      .setDescription('Audit private characters')
      .addStringOption((option) =>
        option
          .setName('game_id')
          .setDescription('Restrict the audit to a specific game id')
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('restore-character')
      .setDescription('Restore any soft-deleted character by id')
      .addStringOption((option) =>
        option
          .setName('character_id')
          .setDescription('Soft-deleted character id')
          .setRequired(true),
      ),
  );

function isOwner(userId: string): boolean {
  return OWNER_IDS.has(userId);
}

async function canAuditGames(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (isOwner(interaction.user.id)) return true;
  if (!interaction.guildId) return false;
  return userOwnsGameInGuild(interaction.user.id, interaction.guildId);
}

module.exports = {
  data,
  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,
  async execute(
    interaction: ChatInputCommandInteraction,
    { responder }: InteractionCommandContext,
  ) {
    if (!interaction.guildId) {
      return responder.respond({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === 'orphans') {
      if (interaction.guildId !== OPS_GUILD_ID) {
        return responder.respond({
          content: '⛔ Orphan audits are only available in the ops guild.',
          ephemeral: true,
        });
      }

      if (!isOwner(interaction.user.id)) {
        return responder.respond({ content: '⛔ Not authorized.', ephemeral: true });
      }

      await handleAdminOrphans(interaction);
      return;
    }

    if (subcommand === 'orphans-purge') {
      if (interaction.guildId !== OPS_GUILD_ID) {
        return responder.respond({
          content: '⛔ Orphan purges are only available in the ops guild.',
          ephemeral: true,
        });
      }

      if (!isOwner(interaction.user.id)) {
        return responder.respond({ content: '⛔ Not authorized.', ephemeral: true });
      }

      await handleAdminOrphansPurge(interaction);
      return;
    }

    if (subcommand === 'global-stats') {
      if (!isOwner(interaction.user.id)) {
        return responder.respond({ content: '⛔ Not authorized.', ephemeral: true });
      }

      await handleAdminGlobalStats(interaction);
      return;
    }

    if (subcommand === 'games') {
      if (!(await canAuditGames(interaction))) {
        return responder.respond({
          content: '⛔ Not authorized. Only the bot owner or a GM in this server can audit games.',
          ephemeral: true,
        });
      }

      await handleAdminGames(interaction);
      return;
    }

    if (subcommand === 'characters') {
      if (isOwner(interaction.user.id)) {
        await handleAdminCharacters(interaction);
        return;
      }

      const gameId = interaction.options.getString('game_id');

      if (!gameId) {
        return responder.respond({
          content:
            '⚠️ GMs must provide a game_id so the private-character audit stays scoped to one of their games.',
          ephemeral: true,
        });
      }

      if (!(await userOwnsGame(interaction.user.id, gameId, interaction.guildId))) {
        return responder.respond({
          content: '⛔ Not authorized. You can only audit private characters for your own games.',
          ephemeral: true,
        });
      }

      await handleAdminCharacters(interaction);
      return;
    }

    if (subcommand === 'restore-character') {
      if (!isOwner(interaction.user.id)) {
        return responder.respond({ content: '⛔ Not authorized.', ephemeral: true });
      }

      await handleAdminRestoreCharacter(interaction);
    }
  },
};
