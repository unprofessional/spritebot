// src/types/discordClient.d.ts

import 'discord.js';
import type { Collection } from 'discord.js';
import type {
  ChatInputCommandInteraction,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicySource,
} from '../discord/interaction_dispatch';

type CommandModule = {
  data: SlashCommandBuilder | ContextMenuCommandBuilder;
  interactionPolicy?: InteractionDispatchPolicySource<
    ChatInputCommandInteraction | MessageContextMenuCommandInteraction
  >;
  execute: (
    interaction: ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
    context?: InteractionCommandContext,
  ) => Promise<unknown>;
};

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, CommandModule>;
  }
}
