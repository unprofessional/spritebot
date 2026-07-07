import {
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import {
  ChannelType,
  Channel,
  Client,
  Guild,
  GuildTextBasedChannel,
  PermissionFlagsBits,
  VoiceBasedChannel,
} from 'discord.js';

import { AudioReceiver } from './audio_receiver';
import { TranscriptionClient } from './transcription_client';
import { encodePcm16MonoWav } from './wav';

export type StartTranscriptionParams = {
  client: Client;
  guild: Guild;
  voiceChannel: VoiceBasedChannel;
  textChannel: GuildTextBasedChannel;
};

export type VoiceSessionStatus = {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  startedAt: Date;
  segmentsTranscribed: number;
};

type VoiceSession = VoiceSessionStatus & {
  connection: VoiceConnection;
  receiver: AudioReceiver;
};

export class VoiceManager {
  private readonly sessions = new Map<string, VoiceSession>();
  private readonly transcriptionClient = new TranscriptionClient();

  async start(params: StartTranscriptionParams): Promise<VoiceSessionStatus> {
    const existing = this.sessions.get(params.guild.id);
    if (existing) return toStatus(existing);

    const botMember = params.guild.members.me ?? (await params.guild.members.fetchMe());
    const permissions = params.voiceChannel.permissionsFor(botMember);
    if (
      !permissions?.has(PermissionFlagsBits.Connect) ||
      !permissions.has(PermissionFlagsBits.Speak)
    ) {
      throw new Error('I need Connect and Speak permissions in that voice channel.');
    }

    const connection = joinVoiceChannel({
      channelId: params.voiceChannel.id,
      guildId: params.guild.id,
      adapterCreator: params.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    const session: VoiceSession = {
      guildId: params.guild.id,
      voiceChannelId: params.voiceChannel.id,
      textChannelId: params.textChannel.id,
      startedAt: new Date(),
      segmentsTranscribed: 0,
      connection,
      receiver: new AudioReceiver(connection, (userId, segment) =>
        this.transcribeSegment(params.client, session, userId, segment.pcm),
      ),
    };

    session.receiver.start();
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      this.sessions.delete(params.guild.id);
    });

    this.sessions.set(params.guild.id, session);
    return toStatus(session);
  }

  stop(guildId: string): boolean {
    const session = this.sessions.get(guildId);
    if (!session) {
      getVoiceConnection(guildId)?.destroy();
      return false;
    }

    session.connection.destroy();
    this.sessions.delete(guildId);
    return true;
  }

  status(guildId: string): VoiceSessionStatus | null {
    const session = this.sessions.get(guildId);
    return session ? toStatus(session) : null;
  }

  private async transcribeSegment(
    client: Client,
    session: VoiceSession,
    userId: string,
    pcm: Buffer,
  ): Promise<void> {
    try {
      const wav = encodePcm16MonoWav(pcm);
      const result = await this.transcriptionClient.transcribeWav(
        wav,
        `${session.guildId}-${userId}-${Date.now()}.wav`,
      );
      if (!result.text) return;

      session.segmentsTranscribed += 1;
      const channel = await client.channels.fetch(session.textChannelId).catch(() => null);
      if (!isTextOutputChannel(channel)) return;

      const user = await client.users.fetch(userId).catch(() => null);
      const displayName = user?.displayName ?? user?.username ?? userId;
      await channel.send(`**${displayName}**: ${result.text}`);
    } catch (err) {
      console.error(`[voice] transcription failed guild=${session.guildId} user=${userId}`, err);
    }
  }
}

function isTextOutputChannel(channel: Channel | null): channel is GuildTextBasedChannel {
  return Boolean(
    channel &&
      (channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement ||
        channel.type === ChannelType.PublicThread ||
        channel.type === ChannelType.PrivateThread ||
        channel.type === ChannelType.AnnouncementThread),
  );
}

function toStatus(session: VoiceSession): VoiceSessionStatus {
  return {
    guildId: session.guildId,
    voiceChannelId: session.voiceChannelId,
    textChannelId: session.textChannelId,
    startedAt: session.startedAt,
    segmentsTranscribed: session.segmentsTranscribed,
  };
}

export const voiceManager = new VoiceManager();
