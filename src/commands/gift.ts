// src/commands/gift.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { GiftedGuildsDAO } from '../dao/gifted_guilds.dao';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

const OWNER_IDS = new Set<string>([(process.env.OWNER_DISCORD_ID ?? '').trim()].filter(Boolean));
const giftedDAO = new GiftedGuildsDAO();

export const data = new SlashCommandBuilder()
  .setName('gift')
  .setDescription('Manage gifted server access (owner only)')
  .addSubcommand((sc) =>
    sc
      .setName('add')
      .setDescription('Gift access to a guild id')
      .addStringOption((o) =>
        o.setName('guild_id').setDescription('Target guild id').setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('recipient_member_id')
          .setDescription('Optional Discord user id to verify as the gift recipient'),
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
  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,
  async execute(
    interaction: ChatInputCommandInteraction,
    { responder }: InteractionCommandContext,
  ) {
    // hard owner gate (extra belt-and-suspenders)
    if (!OWNER_IDS.has(interaction.user.id)) {
      return responder.respond({ content: '⛔ Not authorized.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand(true);

    if (sub === 'add') {
      const guildId = interaction.options.getString('guild_id', true).trim();
      const recipientMemberId =
        interaction.options.getString('recipient_member_id')?.trim() || null;
      const note = interaction.options.getString('note') ?? null;
      const days = interaction.options.getInteger('days') ?? null;
      const expiresAt = days ? new Date(Date.now() + days * 24 * 3600 * 1000) : null;

      await giftedDAO.upsertGift({
        guildId,
        grantedBy: interaction.user.id,
        recipientMemberId,
        note,
        expiresAt,
      });

      return responder.respond({
        content: `✅ Gifted **${guildId}**${recipientMemberId ? ` to <@${recipientMemberId}>` : ''}${expiresAt ? ` until **${expiresAt.toISOString()}**` : ' (no expiry)'}.`,
        ephemeral: true,
      });
    }

    if (sub === 'revoke') {
      const guildId = interaction.options.getString('guild_id', true).trim();
      const ok = await giftedDAO.revokeGift(guildId);
      return responder.respond({
        content: ok
          ? `🗑️ Revoked gift for **${guildId}**.`
          : `ℹ️ No gift existed for **${guildId}**.`,
        ephemeral: true,
      });
    }

    if (sub === 'list') {
      const rows = await giftedDAO.list({ limit: 25 });
      if (!rows.length) {
        return responder.respond({ content: 'No gifted guilds.', ephemeral: true });
      }
      const lines = rows.map((r) => {
        const guild = interaction.client.guilds.cache.get(r.guild_id);
        const name = guild ? `**${guild.name}**` : r.guild_id;
        const id = guild ? ` (${r.guild_id})` : '';
        const exp = r.expires_at ? `, expires: ${r.expires_at}` : '';
        const recipient = r.recipient_member_id ? `, recipient: <@${r.recipient_member_id}>` : '';
        const n = r.note ? ` — ${r.note}` : '';
        return `• ${name}${id}${recipient}${exp}${n}`;
      });
      return responder.respond({ content: lines.join('\n'), ephemeral: true });
    }
  },
};
