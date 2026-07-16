import {
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  type CreateVoiceConnectionOptions,
  type JoinVoiceChannelOptions,
  type VoiceConnection,
  type VoiceConnectionStatus,
} from '@discordjs/voice';

import { executeDiscordOperation } from './operation_executor';
import type { DiscordOperationPolicy } from './operation_policy';

export function joinDiscordVoiceChannel(
  policy: DiscordOperationPolicy,
  options: CreateVoiceConnectionOptions & JoinVoiceChannelOptions,
): Promise<VoiceConnection> {
  return executeDiscordOperation(policy, async () => joinVoiceChannel(options));
}

export function waitForDiscordVoiceState(
  policy: DiscordOperationPolicy,
  connection: VoiceConnection,
  status: VoiceConnectionStatus,
  timeoutMs: number,
): Promise<VoiceConnection> {
  return executeDiscordOperation(policy, async () => entersState(connection, status, timeoutMs));
}

export function destroyExistingDiscordVoiceConnection(
  policy: DiscordOperationPolicy,
  guildId: string,
): Promise<void> {
  return executeDiscordOperation(policy, async () => {
    getVoiceConnection(guildId)?.destroy();
  });
}
