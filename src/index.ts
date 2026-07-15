// src/index.ts

import { Client, GatewayIntentBits } from 'discord.js';
import dotenv = require('dotenv');

import { startBumpScheduler } from './schedulers/bump_scheduler';
import { startCleanupScheduler, stopCleanupScheduler } from './schedulers/cleanup_scheduler';
import { initializeEntitlementEvents } from './client/entitlement_events';
import { initializeCommands } from './client/initial_commands';
import { initializeRoleplayProxy } from './client/rp_proxy_events';
import { initializeSupportVerificationEvents } from './client/support_verification_events';
import { closeDb, getPoolStats } from './db/client';
import { initializeDB, testPgConnection } from './db/db';
import { sendLifecycleNotification } from './services/lifecycle_notification.service';
import { stopCharacterDraftPurge } from './services/character_draft.service';
import { installSignalHandlers, registerShutdownHook } from './runtime/lifecycle';
import { initializeVoiceTranscription, voiceManager } from './voice/voice_manager';

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

installSignalHandlers({
  waitTimeoutMs: 60_000,
  async stopVoice() {
    const summary = await voiceManager.stopAllForShutdown({ timeoutMs: 15_000 });
    console.log(
      `[lifecycle] voice shutdown stopped=${summary.stopped} timedOut=${summary.timedOut} remaining=${summary.remainingSessions}`,
    );
  },
  async sendShutdownNotification() {
    await sendLifecycleNotification(client, 'shutdown', { allowDuringDrain: true });
  },
  destroyClient() {
    client.destroy();
  },
  async closeDb() {
    const before = getPoolStats();
    if (before) {
      console.log(
        `[lifecycle] closing db pool total=${before.totalCount} idle=${before.idleCount} waiting=${before.waitingCount}`,
      );
    }
    await closeDb();
  },
});

async function main(): Promise<void> {
  try {
    await initializeCommands(client);
    initializeEntitlementEvents(client);
    initializeRoleplayProxy(client);
    initializeSupportVerificationEvents(client);
    initializeVoiceTranscription(client);
    await testPgConnection();
    await initializeDB();

    client.once('ready', () => {
      console.log(`✅ Logged in as ${client.user?.tag}`);
      const bumpScheduler = startBumpScheduler(client);
      registerShutdownHook('bump scheduler', async () => {
        bumpScheduler.stopAcceptingWork();
        const drained = await bumpScheduler.drain(10_000);
        if (!drained) console.warn('[lifecycle] bump scheduler drain timed out.');
      });

      startCleanupScheduler();
      registerShutdownHook('cleanup scheduler', () => stopCleanupScheduler({ wait: true }));
      registerShutdownHook('character draft purge', stopCharacterDraftPurge);

      void sendLifecycleNotification(client, 'online');
    });

    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (err) {
    console.error('❌ Bot startup failed:', err);
    process.exit(1);
  }
}

void main();
