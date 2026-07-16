import { pipeline } from 'node:stream';
import type { VoiceConnection } from '@discordjs/voice';
import { EndBehaviorType } from '@discordjs/voice';
import prism from 'prism-media';

import { defineDiscordOperationPolicy } from '../discord/operation_policy';
import { executeDiscordSdkMethod } from '../discord/sdk_operations';
import { Pcm48StereoTo16Mono } from './pcm_downsampler';
import { SegmentBuffer, SpeechSegment } from './segment_buffer';

type SegmentHandler = (userId: string, segment: SpeechSegment) => void | Promise<void>;
const receiverSubscribePolicy = defineDiscordOperationPolicy({
  operation: 'voice.subscribe-receiver',
  timeoutMs: 1_000,
  totalBudgetMs: 1_000,
});
const receiverDestroyPolicy = defineDiscordOperationPolicy({
  operation: 'voice.destroy-receiver-stream',
  timeoutMs: 1_000,
  totalBudgetMs: 1_000,
});

export class AudioReceiver {
  private readonly activeUsers = new Set<string>();

  constructor(
    private readonly connection: VoiceConnection,
    private readonly onSegment: SegmentHandler,
  ) {}

  start(): void {
    this.connection.receiver.speaking.on('start', (userId) => {
      void this.subscribe(userId).catch((error) => {
        this.activeUsers.delete(userId);
        console.warn(`[voice] receiver subscription failed user=${userId}`, error);
      });
    });
  }

  private async subscribe(userId: string): Promise<void> {
    if (this.activeUsers.has(userId)) return;
    this.activeUsers.add(userId);

    const opus = await executeDiscordSdkMethod(
      receiverSubscribePolicy,
      this.connection.receiver,
      'subscribe',
      userId,
      {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1_000,
        },
      },
    );
    let decoder: prism.opus.Decoder;
    try {
      decoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 2,
        rate: 48_000,
      });
    } catch (err) {
      this.activeUsers.delete(userId);
      console.error(
        '[voice] unable to create Opus decoder; install opusscript or @discordjs/opus',
        err,
      );
      await executeDiscordSdkMethod(receiverDestroyPolicy, opus, 'destroy');
      return;
    }
    const downsampler = new Pcm48StereoTo16Mono();
    const segments = new SegmentBuffer();

    downsampler.on('data', (chunk: Buffer) => {
      const segment = segments.push(chunk);
      if (segment) void this.onSegment(userId, segment);
    });

    opus.once('error', (err) => {
      this.activeUsers.delete(userId);
      console.warn(`[voice] opus stream failed user=${userId}`, err);
    });

    pipeline(opus, decoder, downsampler, (err) => {
      if (err) {
        console.warn(`[voice] audio pipeline failed user=${userId}`, err);
      } else {
        const segment = segments.flush();
        if (segment) void this.onSegment(userId, segment);
      }
      this.activeUsers.delete(userId);
    });
  }
}
