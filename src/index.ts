// src/index.ts

import { Client, GatewayIntentBits } from 'discord.js';
import dotenv = require('dotenv');

import { startBumpScheduler } from 'schedulers/bump_scheduler';
import { initializeCommands } from './client/initial_commands';
import { initializeDB, testPgConnection } from './db/db';

dotenv.config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function main(): Promise<void> {
  try {
    await initializeCommands(client);
    await testPgConnection();
    await initializeDB();
    await client.login(process.env.DISCORD_BOT_TOKEN);

    client.once('ready', () => {
      console.log(`✅ Logged in as ${client.user?.tag}`);
      startBumpScheduler(client);
    });
  } catch (err) {
    console.error('❌ Bot startup failed:', err);
    process.exit(1);
  }
}

void main();
