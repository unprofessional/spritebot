// src/client/initial_commands.ts

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  BaseInteraction,
  ChatInputCommandInteraction,
  Client,
  Collection,
  ContextMenuCommandBuilder,
  Events,
  MessageContextMenuCommandInteraction,
  REST,
  Routes,
  type SlashCommandBuilder,
} from 'discord.js';
import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord-api-types/v10';
import dotenv = require('dotenv');
dotenv.config();

import { handleButton } from '../handlers/button_handlers';
import { handleModal } from '../handlers/modal_handlers';
import { handleSelectMenu } from '../handlers/select_menu_handlers';
import { guardCommand, guardComponent } from '../access/guards';
import { supportGuildId } from '../config/env_config';
import {
  DRAINING_REPLY,
  isDrainInProgressError,
  isDraining,
  trackOperation,
} from '../runtime/lifecycle';
import {
  respondBestEffort,
  startTrackedInteractionDispatch,
  type InteractionCommandContext,
  type InteractionDispatchPolicySource,
} from '../discord/interaction_dispatch';
import { logDiscordFailure } from '../discord/logging';

const { DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN } = process.env;
// Allow override via env; default to the provided ops guild id
const DEV_GUILD_ID = process.env.DEV_GUILD_ID;

const isProd = process.env.NODE_ENV === 'production' || __dirname.includes('/dist/');
const commandExtension = isProd ? '.js' : '.ts';
const commandDir = isProd
  ? path.resolve(__dirname, '../commands') // dist/commands
  : path.resolve(__dirname, '../commands'); // src/commands
const requireCommand = createRequire(__filename);

// --- Types ---
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

// --- Small helpers ---
const readCommandFiles = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? readCommandFiles(path.join(dir, e.name)) : []))
    .concat(
      fs
        .readdirSync(dir)
        .filter((n) => n.endsWith(commandExtension))
        .map((n) => path.join(dir, n)),
    );

const isCommandModule = (x: unknown): x is CommandModule =>
  !!x &&
  typeof x === 'object' &&
  'data' in x &&
  'execute' in x &&
  typeof (x as { execute?: unknown }).execute === 'function';

async function loadCommands(files: string[]): Promise<CommandModule[]> {
  const loaded: CommandModule[] = [];
  for (const file of files) {
    try {
      const mod = requireCommand(file) as { default?: unknown } & Record<string, unknown>;
      const candidate = (mod.default ?? mod) as unknown;
      if (isCommandModule(candidate)) {
        loaded.push(candidate);
        console.log(`✅ /${candidate.data.name}`);
      } else {
        console.warn(`⚠️ Skipped ${path.basename(file)} (missing data/execute)`);
      }
    } catch (err) {
      console.error(`❌ Import failed: ${path.basename(file)}`, err);
    }
  }
  return loaded;
}

async function registerGlobalCommands(rest: REST, cmds: CommandModule[]) {
  const payload: RESTPostAPIApplicationCommandsJSONBody[] = cmds.map((c) => c.data.toJSON());
  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID!), { body: payload });
  console.log(`🛰️  Registered ${payload.length} global command(s)`);
}

async function registerOpsCommands(rest: REST, opsCmds: CommandModule[]) {
  if (!DEV_GUILD_ID) {
    console.warn('⚠️ DEV_GUILD_ID not set; skipping ops-only command registration.');
    return;
  }
  const payload: RESTPostAPIApplicationCommandsJSONBody[] = opsCmds.map((c) => c.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID!, DEV_GUILD_ID), {
    body: payload,
  });
  console.log(`🛰️  Registered ${payload.length} ops-only command(s) in guild ${DEV_GUILD_ID}`);
}

async function registerSupportCommands(rest: REST, supportCmds: CommandModule[]) {
  if (!supportGuildId) {
    console.warn('⚠️ SUPPORT_GUILD_ID not set; skipping support command registration.');
    return;
  }

  const payload: RESTPostAPIApplicationCommandsJSONBody[] = supportCmds.map((c) => c.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID!, supportGuildId), {
    body: payload,
  });
  console.log(`🛰️  Registered ${payload.length} support command(s) in guild ${supportGuildId}`);
}

async function registerScopedCommands(
  rest: REST,
  opsCmds: CommandModule[],
  supportCmds: CommandModule[],
) {
  if (DEV_GUILD_ID && DEV_GUILD_ID === supportGuildId) {
    const scopedCommands = new Map<string, CommandModule>();
    for (const command of [...opsCmds, ...supportCmds]) {
      scopedCommands.set(command.data.name, command);
    }

    const payload: RESTPostAPIApplicationCommandsJSONBody[] = [...scopedCommands.values()].map(
      (c) => c.data.toJSON(),
    );
    await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID!, DEV_GUILD_ID), {
      body: payload,
    });
    console.log(
      `🛰️  Registered ${payload.length} scoped command(s) in shared ops/support guild ${DEV_GUILD_ID}`,
    );
    return;
  }

  await registerOpsCommands(rest, opsCmds);
  await registerSupportCommands(rest, supportCmds);
}

const safeFallback = async (interaction: BaseInteraction) => {
  const reply = {
    content: 'There was an error while executing this action.',
    ephemeral: true as const,
  };
  await respondBestEffort(interaction, reply, 'error-fallback');
};

const drainFallback = async (interaction: BaseInteraction) => {
  const reply = {
    content: DRAINING_REPLY,
    ephemeral: true as const,
  };
  await respondBestEffort(interaction, reply, 'drain-fallback');
};

function logInteractionFailure(
  context: 'interaction-error' | 'terminal',
  interaction: BaseInteraction,
  error: unknown,
): void {
  const metadata = interaction as BaseInteraction & { commandName?: string; customId?: string };
  logDiscordFailure(
    {
      operation: `interaction.${context}`,
      error,
      attempt: 1,
      elapsedMs: 0,
      commandName: metadata.commandName,
      customId: metadata.customId,
    },
    console.error,
  );
}

export async function dispatchInteraction(client: Client, interaction: BaseInteraction) {
  if (isDraining()) {
    await drainFallback(interaction);
    return;
  }

  if (interaction.isChatInputCommand() || interaction.isMessageContextMenuCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (command?.interactionPolicy) {
      const policy =
        typeof command.interactionPolicy === 'function'
          ? command.interactionPolicy(interaction)
          : command.interactionPolicy;
      await startTrackedInteractionDispatch({
        interaction,
        policy,
        guard: policy.authorization === 'modal-submit' ? undefined : guardCommand,
        handler: (routedInteraction, responder) =>
          command.execute(routedInteraction, { responder }),
      });
      return;
    }
  }

  try {
    await trackOperation(`interaction:${interaction.type}`, async () => {
      if (interaction.isChatInputCommand()) {
        const auth = await guardCommand(interaction);
        if (auth !== true) return interaction.reply({ content: auth, ephemeral: true });

        const cmd = client.commands.get(interaction.commandName);
        if (!cmd) return console.warn(`⚠️ Unknown command: ${interaction.commandName}`);
        await cmd.execute(interaction);
        return;
      }

      if (interaction.isMessageContextMenuCommand()) {
        const auth = await guardCommand(interaction);
        if (auth !== true) return interaction.reply({ content: auth, ephemeral: true });

        const cmd = client.commands.get(interaction.commandName);
        if (!cmd) return console.warn(`⚠️ Unknown command: ${interaction.commandName}`);
        await cmd.execute(interaction);
        return;
      }

      if (interaction.isModalSubmit()) {
        const auth = await guardComponent(interaction);
        if (auth !== true) return interaction.reply({ content: auth, ephemeral: true });
        return handleModal(interaction);
      }

      if (interaction.isButton()) {
        const auth = await guardComponent(interaction);
        if (auth !== true) return interaction.reply({ content: auth, ephemeral: true });
        return handleButton(interaction);
      }

      if (interaction.isStringSelectMenu()) {
        const auth = await guardComponent(interaction);
        if (auth !== true) return interaction.reply({ content: auth, ephemeral: true });
        return handleSelectMenu(interaction);
      }

      console.warn('⚠️ Unhandled interaction:', interaction.type);
    });
  } catch (err) {
    if (isDrainInProgressError(err)) {
      await drainFallback(interaction);
      return;
    }
    logInteractionFailure('interaction-error', interaction, err);
    await safeFallback(interaction);
  }
}

// --- Main ---
export async function initializeCommands(client: Client): Promise<Client> {
  if (!fs.existsSync(commandDir)) throw new Error(`Command directory missing: ${commandDir}`);

  console.log(`📂 Commands: ${commandDir}`);
  const files = readCommandFiles(commandDir);
  console.log(`📄 Found ${files.length} file(s)`);

  // Load into memory
  const commands = await loadCommands(files);

  // Split: ops/support scoped vs global (by name). Keep '/gift' out of global registration.
  const opsOnly = new Set<string>(['gift', 'toggle-bypass']);
  const supportOnly = new Set<string>(['gift', 'verify', 'verify-greeting']);
  const opsCommands = commands.filter((c) => opsOnly.has(c.data.name));
  const supportCommands = commands.filter((c) => supportOnly.has(c.data.name));
  const globalCommands = commands.filter(
    (c) => !opsOnly.has(c.data.name) && !supportOnly.has(c.data.name),
  );

  console.log(
    `🧭 Command split → global=${globalCommands.length} ops-only=${opsCommands.length} support-only=${supportCommands.length}`,
  );

  // Index on client (typed via your src/types/discordClient.d.ts)
  // We register all in memory so they can execute where available.
  client.commands = new Collection(commands.map((c) => [c.data.name, c]));

  // Publish to Discord
  const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN!);
  try {
    await registerGlobalCommands(rest, globalCommands);
    await registerScopedCommands(rest, opsCommands, supportCommands);
  } catch (err) {
    console.error('❌ Command registration failed:', err);
  }

  // Interactions
  client.on(Events.InteractionCreate, (interaction) => {
    void dispatchInteraction(client, interaction).catch((err) => {
      logInteractionFailure('terminal', interaction, err);
      void safeFallback(interaction);
    });
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`🤖 Logged in as ${c.user.tag}`);
    c.user.setPresence({
      activities: [{ name: 'Tracking inventories and stats', type: 0 }],
      status: 'online',
    });
  });

  return client;
}
