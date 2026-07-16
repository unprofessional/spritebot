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
import {
  installSignalHandlers,
  registerShutdownHook,
  runGracefulShutdown,
} from './runtime/lifecycle';
import {
  createRuntimeInstanceId,
  ensureRuntimeInstanceLeaseTable,
  RuntimeInstanceLease,
  waitForRuntimeInstanceLease,
} from './runtime/instance_lease';
import { initializeVoiceTranscription, voiceManager } from './voice/voice_manager';
import {
  runtimeInstanceId,
  runtimeInstanceMode,
  runtimeLeaseHeartbeatMs,
  runtimeLeaseStandbyPollMs,
  runtimeLeaseTtlMs,
} from './config/env_config';
import { defineDiscordOperationPolicy } from './discord/operation_policy';
import { executeDiscordSdkMethod } from './discord/sdk_operations';

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

let activeLease: RuntimeInstanceLease | null = null;
const clientLoginPolicy = defineDiscordOperationPolicy({
  operation: 'client.login',
  timeoutMs: 30_000,
  totalBudgetMs: 30_000,
});
const clientDestroyPolicy = defineDiscordOperationPolicy({
  operation: 'client.destroy',
  timeoutMs: 5_000,
  totalBudgetMs: 5_000,
});

const shutdownOptions = {
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
  async destroyClient() {
    await executeDiscordSdkMethod(clientDestroyPolicy, client, 'destroy');
  },
  async closeDb() {
    if (activeLease) {
      await activeLease.release();
      activeLease = null;
    }

    const before = getPoolStats();
    if (before) {
      console.log(
        `[lifecycle] closing db pool total=${before.totalCount} idle=${before.idleCount} waiting=${before.waitingCount}`,
      );
    }
    await closeDb();
  },
};

installSignalHandlers(shutdownOptions);

async function main(): Promise<void> {
  try {
    await testPgConnection();
    await initializeDB();
    await ensureRuntimeInstanceLeaseTable();

    const instanceId = runtimeInstanceId || createRuntimeInstanceId();
    console.log(
      `[runtime-lease] instance starting mode=${runtimeInstanceMode} instance=${instanceId}`,
    );
    activeLease = await waitForRuntimeInstanceLease({
      instanceId,
      mode: runtimeInstanceMode,
      ttlMs: runtimeLeaseTtlMs,
      pollMs: runtimeLeaseStandbyPollMs,
      metadata: {
        pid: process.pid,
        runMode: process.env.RUN_MODE ?? 'development',
      },
    });
    activeLease.startHeartbeat({
      intervalMs: runtimeLeaseHeartbeatMs,
      onLost(error) {
        console.error('[runtime-lease] active lease lost; beginning graceful shutdown.', error);
        void runGracefulShutdown('manual', shutdownOptions);
      },
    });

    await initializeCommands(client);
    initializeEntitlementEvents(client);
    initializeRoleplayProxy(client);
    initializeSupportVerificationEvents(client);
    initializeVoiceTranscription(client);

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

    await executeDiscordSdkMethod(
      clientLoginPolicy,
      client,
      'login',
      process.env.DISCORD_BOT_TOKEN,
    );
  } catch (err) {
    console.error('❌ Bot startup failed:', err);
    process.exit(1);
  }
}

void main();
