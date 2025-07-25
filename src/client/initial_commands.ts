// src/client/initial_commands.ts

import fs from 'node:fs';
import path from 'node:path';
import { ChatInputCommandInteraction, Client, Collection, Events, REST, Routes } from 'discord.js';
import dotenv = require('dotenv');
dotenv.config();

import type { SlashCommandBuilder } from 'discord.js';
import { handleButton } from '../handlers/button_handlers';
import { handleModal } from '../handlers/modal_handlers';
import { handleSelectMenu } from '../handlers/select_menu_handlers';

const { DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN } = process.env;

// Detect prod vs dev using both NODE_ENV and __dirname
const isProd = process.env.NODE_ENV === 'production' || __dirname.includes('/dist/');

// Determine file extension and command directory
const commandExtension = isProd ? '.js' : '.ts';
const commandDir = isProd
  ? path.resolve(__dirname, '../commands') // dist/commands
  : path.resolve(__dirname, '../../commands'); // src/commands

const readCommandFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return readCommandFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(commandExtension) ? [fullPath] : [];
  });

export async function initializeCommands(client: Client): Promise<Client> {
  if (!fs.existsSync(commandDir)) {
    console.error(`❌ Command directory not found: ${commandDir}`);
    throw new Error('Command directory missing.');
  }

  const commandFiles = readCommandFiles(commandDir);
  console.log(`📂 Scanning commands from: ${commandDir}`);
  console.log(`📄 Found ${commandFiles.length} command file(s)`);

  const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN!);
  const apiCommands: any[] = [];
  client.commands = new Collection();

  for (const file of commandFiles) {
    try {
      const mod = (await import(file)) as Partial<CommandModule> & { default?: CommandModule };
      const cmd = mod.default ?? mod;
      if (cmd.data && cmd.execute) {
        client.commands.set(cmd.data.name, cmd);
        apiCommands.push(cmd.data.toJSON());
        console.log(`✅ Loaded /${cmd.data.name}`);
      } else {
        console.warn(`⚠️ Skipped ${file}: missing "data" or "execute"`);
      }
    } catch (err) {
      console.error(`❌ Failed to import ${file}:`, err);
    }
  }

  try {
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID!), { body: apiCommands });
    console.log(`✅ Registered ${apiCommands.length} global commands`);
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }

  const fallbackReply = async (interaction: any) => {
    const reply = { content: 'There was an error while executing this action.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  };

  client.on(Events.InteractionCreate, (interaction) => {
    void (async () => {
      try {
        if (interaction.isChatInputCommand()) {
          const cmd = client.commands.get(interaction.commandName);
          if (!cmd) return console.warn(`⚠️ Unknown command: ${interaction.commandName}`);
          await cmd.execute(interaction);
        } else if (interaction.isModalSubmit()) await handleModal(interaction);
        else if (interaction.isButton()) await handleButton(interaction);
        else if (interaction.isStringSelectMenu()) await handleSelectMenu(interaction);
        else console.warn('⚠️ Unhandled interaction:', interaction.type);
      } catch (err) {
        console.error('❌ Interaction error:', err);
        await fallbackReply(interaction);
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

type CommandModule = {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};
