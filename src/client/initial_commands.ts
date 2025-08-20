// src/client/initial_commands.ts

import fs from 'node:fs';
import path from 'node:path';
import {
  BaseInteraction,
  ChatInputCommandInteraction,
  Client,
  Collection,
  Events,
  REST,
  Routes,
  type SlashCommandBuilder,
} from 'discord.js';
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord-api-types/v10';
import dotenv = require('dotenv');
dotenv.config();

import { handleButton } from '../handlers/button_handlers';
import { handleModal } from '../handlers/modal_handlers';
import { handleSelectMenu } from '../handlers/select_menu_handlers';
import { guardSlash, guardComponent } from '../access/guards';

const { DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN } = process.env;
// Allow override via env; default to the provided ops guild id
const DEV_GUILD_ID = process.env.DEV_GUILD_ID;

const isProd = process.env.NODE_ENV === 'production' || __dirname.includes('/dist/');
const commandExtension = isProd ? '.js' : '.ts';
const commandDir = isProd
  ? path.resolve(__dirname, '../commands') // dist/commands
  : path.resolve(__dirname, '../../commands'); // src/commands

// --- Types ---
type CommandModule = {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
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
  typeof (x as any).execute === 'function';

async function loadCommands(files: string[]): Promise<CommandModule[]> {
  const loaded: CommandModule[] = [];
  for (const file of files) {
    try {
      const mod = (await import(file)) as { default?: unknown } & Record<string, unknown>;
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
  const payload: RESTPostAPIChatInputApplicationCommandsJSONBody[] = cmds.map((c) =>
    c.data.toJSON(),
  );
  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID!), { body: payload });
  console.log(`🛰️  Registered ${payload.length} global command(s)`);
}

async function registerOpsCommands(rest: REST, opsCmds: CommandModule[]) {
  if (!DEV_GUILD_ID) {
    console.warn('⚠️ DEV_GUILD_ID not set; skipping ops-only command registration.');
    return;
  }
  const payload: RESTPostAPIChatInputApplicationCommandsJSONBody[] = opsCmds.map((c) =>
    c.data.toJSON(),
  );
  await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID!, DEV_GUILD_ID), {
    body: payload,
  });
  console.log(`🛰️  Registered ${payload.length} ops-only command(s) in guild ${DEV_GUILD_ID}`);
}

const safeFallback = async (interaction: BaseInteraction) => {
  if (!interaction.isRepliable()) return;
  const reply = {
    content: 'There was an error while executing this action.',
    ephemeral: true as const,
  };
  if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
  else await interaction.reply(reply);
};

// --- Main ---
export async function initializeCommands(client: Client): Promise<Client> {
  if (!fs.existsSync(commandDir)) throw new Error(`Command directory missing: ${commandDir}`);

  console.log(`📂 Commands: ${commandDir}`);
  const files = readCommandFiles(commandDir);
  console.log(`📄 Found ${files.length} file(s)`);

  // Load into memory
  const commands = await loadCommands(files);

  // Split: ops-only vs global (by name). Keep '/gift' ops-only.
  const opsOnly = new Set<string>(['gift']); // add more names here if needed
  const opsCommands = commands.filter((c) => opsOnly.has(c.data.name));
  const globalCommands = commands.filter((c) => !opsOnly.has(c.data.name));

  console.log(`🧭 Command split → global=${globalCommands.length} ops-only=${opsCommands.length}`);

  // Index on client (typed via your src/types/discordClient.d.ts)
  // We register all in memory so they can execute where available.
  client.commands = new Collection(commands.map((c) => [c.data.name, c]));

  // Publish to Discord
  const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN!);
  try {
    await registerGlobalCommands(rest, globalCommands);
    await registerOpsCommands(rest, opsCommands);
  } catch (err) {
    console.error('❌ Command registration failed:', err);
  }

  // Interactions
  client.on(Events.InteractionCreate, (interaction) => {
    void (async () => {
      try {
        if (interaction.isChatInputCommand()) {
          const auth = await guardSlash(interaction);
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
      } catch (err) {
        console.error('❌ Interaction error:', err);
        await safeFallback(interaction);
      }
    })();
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
