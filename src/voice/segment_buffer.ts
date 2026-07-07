import {
  transcriptionMaxSegmentMs,
  transcriptionMinSegmentMs,
  transcriptionSilenceMs,
  transcriptionVadThreshold,
} from '../config/env_config';

const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;
const DEFAULT_CHUNK_MS = 20;

export type SpeechSegment = {
  pcm: Buffer;
  startedAt: Date;
  durationMs: number;
};

export type SegmentBufferOptions = {
  silenceMs?: number;
  maxSegmentMs?: number;
  minSegmentMs?: number;
  speechThreshold?: number;
};

export class SegmentBuffer {
  private chunks: Buffer[] = [];
  private startedAt: Date | null = null;
  private speechMs = 0;
  private silenceMs = 0;
  private totalMs = 0;

  private readonly silenceLimitMs: number;
  private readonly maxSegmentMs: number;
  private readonly minSegmentMs: number;
  private readonly speechThreshold: number;

  constructor(options: SegmentBufferOptions = {}) {
    this.silenceLimitMs = options.silenceMs ?? transcriptionSilenceMs;
    this.maxSegmentMs = options.maxSegmentMs ?? transcriptionMaxSegmentMs;
    this.minSegmentMs = options.minSegmentMs ?? transcriptionMinSegmentMs;
    this.speechThreshold = options.speechThreshold ?? transcriptionVadThreshold;
  }

  push(pcm: Buffer): SpeechSegment | null {
    const durationMs = pcmDurationMs(pcm);
    const hasSpeech = rms(pcm) >= this.speechThreshold;

    if (hasSpeech && !this.startedAt) {
      this.startedAt = new Date();
    }

    if (!this.startedAt) return null;

    this.chunks.push(pcm);
    this.totalMs += durationMs;

    if (hasSpeech) {
      this.speechMs += durationMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += durationMs;
    }

    if (this.totalMs >= this.maxSegmentMs || this.silenceMs >= this.silenceLimitMs) {
      return this.flush();
    }

    return null;
  }

  flush(): SpeechSegment | null {
    if (!this.startedAt || this.speechMs < this.minSegmentMs) {
      this.reset();
      return null;
    }

    const segment: SpeechSegment = {
      pcm: Buffer.concat(this.chunks),
      startedAt: this.startedAt,
      durationMs: this.totalMs,
    };
    this.reset();
    return segment;
  }

  private reset(): void {
    this.chunks = [];
    this.startedAt = null;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.totalMs = 0;
  }
}

function pcmDurationMs(pcm: Buffer): number {
  const samples = pcm.length / BYTES_PER_SAMPLE;
  return Math.max(DEFAULT_CHUNK_MS, (samples / SAMPLE_RATE) * 1000);
}

function rms(pcm: Buffer): number {
  if (pcm.length < BYTES_PER_SAMPLE) return 0;

  let sumSquares = 0;
  const samples = Math.floor(pcm.length / BYTES_PER_SAMPLE);
  for (let offset = 0; offset + 1 < pcm.length; offset += BYTES_PER_SAMPLE) {
    const normalized = pcm.readInt16LE(offset) / 32768;
    sumSquares += normalized * normalized;
  }

  return Math.sqrt(sumSquares / samples);
}
