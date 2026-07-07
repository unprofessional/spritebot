// src/index.ts

import { Client, GatewayIntentBits } from 'discord.js';
import dotenv = require('dotenv');

import { startBumpScheduler } from './schedulers/bump_scheduler';
import { initializeCommands } from './client/initial_commands';
import { initializeRoleplayProxy } from './client/rp_proxy_events';
import { initializeDB, testPgConnection } from './db/db';
import {
  installShutdownNotifications,
  sendLifecycleNotification,
} from './services/lifecycle_notification.service';
import { initializeVoiceTranscription } from './voice/voice_manager';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

async function main(): Promise<void> {
  try {
    await initializeCommands(client);
    initializeRoleplayProxy(client);
    initializeVoiceTranscription(client);
    installShutdownNotifications(client);
    await testPgConnection();
    await initializeDB();

    client.once('ready', () => {
      console.log(`✅ Logged in as ${client.user?.tag}`);
      startBumpScheduler(client);
      void sendLifecycleNotification(client, 'online');
    });

    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (err) {
    console.error('❌ Bot startup failed:', err);
    process.exit(1);
  }
}

void main();
