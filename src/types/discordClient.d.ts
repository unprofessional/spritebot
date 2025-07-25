// src/types/discordClient.d.ts

import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

type CommandModule = {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, CommandModule>;
  }
}
