// src/index.ts

import { Client, GatewayIntentBits } from 'discord.js';
import dotenv = require('dotenv');

import { startBumpScheduler } from './schedulers/bump_scheduler';
import { startCleanupScheduler } from './schedulers/cleanup_scheduler';
import { initializeEntitlementEvents } from './client/entitlement_events';
import { initializeCommands } from './client/initial_commands';
import { initializeRoleplayProxy } from './client/rp_proxy_events';
import { initializeSupportVerificationEvents } from './client/support_verification_events';
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
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

async function main(): Promise<void> {
  try {
    await initializeCommands(client);
    initializeEntitlementEvents(client);
    initializeRoleplayProxy(client);
    initializeSupportVerificationEvents(client);
    initializeVoiceTranscription(client);
    installShutdownNotifications(client);
    await testPgConnection();
    await initializeDB();

    client.once('ready', () => {
      console.log(`✅ Logged in as ${client.user?.tag}`);
      startBumpScheduler(client);
      startCleanupScheduler();
      void sendLifecycleNotification(client, 'online');
    });

    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (err) {
    console.error('❌ Bot startup failed:', err);
    process.exit(1);
  }
}

void main();
