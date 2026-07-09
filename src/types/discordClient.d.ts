// src/types/discordClient.d.ts

import 'discord.js';
import type { Collection } from 'discord.js';
import type {
  ChatInputCommandInteraction,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';

type CommandModule = {
  data: SlashCommandBuilder | ContextMenuCommandBuilder;
  execute: (
    interaction: ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
  ) => Promise<unknown>;
};

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, CommandModule>;
  }
}
