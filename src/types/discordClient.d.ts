// src/types/discordClient.d.ts

import 'discord.js';
import type { Collection } from 'discord.js';
import type { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

type CommandModule = {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, CommandModule>;
  }
}
