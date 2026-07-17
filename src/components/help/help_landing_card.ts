import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

export function build() {
  const embed = new EmbedBuilder()
    .setTitle('🎮 Welcome to SPRITE')
    .setDescription('Pick your role to see the commands that matter to you.')
    .setColor(0x5865f2);

  const roles = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('help:role:player')
      .setLabel("🎮 I'm a Player")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('help:role:gm')
      .setLabel("🛡️ I'm a GM / Server Admin")
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [roles], ephemeral: true as const };
}
