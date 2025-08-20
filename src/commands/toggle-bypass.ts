// src/commands/toggle-bypass.ts
import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { setOwnerBypass, toggleOwnerBypass } from '../access/bypass';

const OWNER_IDS = new Set<string>([(process.env.OWNER_DISCORD_ID ?? '').trim()].filter(Boolean));
const OPS_GUILD_ID = process.env.DEV_GUILD_ID ?? '';

export const data = new SlashCommandBuilder()
  .setName('toggle-bypass')
  .setDescription('Toggle test bypasses (ops guild only)')
  .addStringOption((o) =>
    o
      .setName('target')
      .setDescription('Bypass to toggle or set')
      .setRequired(true)
      .addChoices({ name: 'owner', value: 'owner' }),
  )
  .addStringOption((o) =>
    o
      .setName('mode')
      .setDescription('on/off (omit to toggle)')
      .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

module.exports = {
  data,
  async execute(interaction: ChatInputCommandInteraction) {
    // Hard scope to ops guild
    if (interaction.guildId !== OPS_GUILD_ID) {
      return interaction.reply({ content: '⛔ Not available here.', ephemeral: true });
    }

    // Owner-only execution
    if (!OWNER_IDS.has(interaction.user.id)) {
      return interaction.reply({ content: '⛔ Not authorized.', ephemeral: true });
    }

    const target = interaction.options.getString('target', true);
    const mode = interaction.options.getString('mode'); // 'on' | 'off' | null

    if (target !== 'owner') {
      return interaction.reply({ content: 'Unsupported target.', ephemeral: true });
    }

    let enabled: boolean;
    if (mode === 'on') {
      setOwnerBypass(true);
      enabled = true;
    } else if (mode === 'off') {
      setOwnerBypass(false);
      enabled = false;
    } else {
      enabled = toggleOwnerBypass();
    }

    return interaction.reply({
      content: `🧰 Owner bypass is now **${enabled ? 'ON' : 'OFF'}**.`,
      ephemeral: true,
    });
  },
};
