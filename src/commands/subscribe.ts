import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CacheType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';

import { GiftedGuildsDAO } from '../dao/gifted_guilds.dao';
import { getEntitlementsFor } from '../services/entitlements.service';

const PREMIUM_SKU_ID = '1405308360818954322';
const giftedDAO = new GiftedGuildsDAO();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription("View or manage this server's SPRITEbot subscription"),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    if (!interaction.guild || !interaction.guildId) {
      return interaction.reply({
        content: 'Use `/subscribe` in a server to view or manage its SPRITEbot subscription.',
        ephemeral: true,
      });
    }

    const guildId = interaction.guildId;
    const [entitlements, isGifted] = await Promise.all([
      getEntitlementsFor({ guildId }),
      giftedDAO.isGifted(guildId),
    ]);
    const hasPaidEntitlement =
      entitlements?.status === 'active' &&
      [...entitlements.features].some((feature) => feature !== 'core');

    if (hasPaidEntitlement || isGifted) {
      const details = ['This server has an active SPRITEbot Premium subscription.'];

      if (hasPaidEntitlement && entitlements?.expiresAt) {
        details.push(`Renews or expires <t:${toUnixTimestamp(entitlements.expiresAt)}:R>.`);
      }

      if (isGifted) {
        details.push('This server also has gifted Premium access.');
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ SPRITEbot Premium')
        .setDescription(details.join('\n'))
        .setColor(0x22c55e);

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const applicationId = interaction.client.application?.id;
    if (!applicationId) {
      return interaction.reply({
        content: 'SPRITEbot subscription management is not available yet. Try again shortly.',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('SPRITEbot Premium')
      .setDescription(
        'Premium unlocks character creation, inventory, game admin tools, thread bumping, and roleplay proxying for this server.',
      )
      .setColor(0x5865f2);

    const subscribeButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Premium)
      .setSKUId(PREMIUM_SKU_ID);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(subscribeButton);

    return interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
  },
};

function toUnixTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
