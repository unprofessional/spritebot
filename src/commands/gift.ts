// src/commands/gift.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { GiftedGuildsDAO } from '../dao/gifted_guilds.dao';

const OWNER_IDS = new Set<string>([(process.env.OWNER_DISCORD_ID ?? '').trim()].filter(Boolean));
const giftedDAO = new GiftedGuildsDAO();

export const data = new SlashCommandBuilder()
  .setName('gift')
  .setDescription('Manage gifted server access (ops guild only)')
  .addSubcommand((sc) =>
    sc
      .setName('add')
      .setDescription('Gift access to a guild id')
      .addStringOption((o) =>
        o.setName('guild_id').setDescription('Target guild id').setRequired(true),
      )
      .addStringOption((o) => o.setName('note').setDescription('Optional note'))
      .addIntegerOption((o) =>
        o.setName('days').setDescription('Expiry in days (omit = no expiry)'),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('revoke')
      .setDescription('Revoke gifted access for a guild id')
      .addStringOption((o) =>
        o.setName('guild_id').setDescription('Target guild id').setRequired(true),
      ),
  )
  .addSubcommand((sc) => sc.setName('list').setDescription('List gifted guilds (recent first)'))
  // Admin perms aren’t strictly necessary in ops guild, but keep it tight:
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

module.exports = {
  data,
  async execute(interaction: ChatInputCommandInteraction) {
    // hard owner gate (extra belt-and-suspenders)
    if (!OWNER_IDS.has(interaction.user.id)) {
      return interaction.reply({ content: '⛔ Not authorized.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand(true);

    if (sub === 'add') {
      const guildId = interaction.options.getString('guild_id', true).trim();
      const note = interaction.options.getString('note') ?? null;
      const days = interaction.options.getInteger('days') ?? null;
      const expiresAt = days ? new Date(Date.now() + days * 24 * 3600 * 1000) : null;

      const row = await giftedDAO.upsertGift({
        guildId,
        grantedBy: interaction.user.id,
        note,
        expiresAt,
      });

      return interaction.reply({
        content: `✅ Gifted **${guildId}**${expiresAt ? ` until **${expiresAt.toISOString()}**` : ' (no expiry)'}.`,
        ephemeral: true,
      });
    }

    if (sub === 'revoke') {
      const guildId = interaction.options.getString('guild_id', true).trim();
      const ok = await giftedDAO.revokeGift(guildId);
      return interaction.reply({
        content: ok
          ? `🗑️ Revoked gift for **${guildId}**.`
          : `ℹ️ No gift existed for **${guildId}**.`,
        ephemeral: true,
      });
    }

    if (sub === 'list') {
      const rows = await giftedDAO.list({ limit: 25 });
      if (!rows.length) {
        return interaction.reply({ content: 'No gifted guilds.', ephemeral: true });
      }
      const lines = rows.map((r) => {
        const exp = r.expires_at ? `, expires: ${r.expires_at}` : '';
        const n = r.note ? ` — ${r.note}` : '';
        return `• ${r.guild_id}${exp}${n}`;
      });
      return interaction.reply({ content: lines.join('\n'), ephemeral: true });
    }
  },
};
