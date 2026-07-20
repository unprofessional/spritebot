import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  FileManifestQueue,
  recoverFileManifestQueue,
} from '../../../src/voice/durable_queue/file_manifest_queue';
import { formatTranscriptionProgress } from '../../../src/voice/progress_message';
import { SegmentSpool } from '../../../src/voice/segment_spool';
import { formatTranscript } from '../../../src/voice/transcript_formatter';
import { TranscriptionCheckpointController } from '../../../src/voice/transcription_checkpoint_controller';
import { TranscriptionScheduler } from '../../../src/voice/transcription_scheduler';

describe('durable transcription overload lifecycle', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), 'spritebot-overload-e2e-'));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  test('covers a modeled three-hour session at 1.5x processing capacity', async () => {
    const segmentCount = 360;
    const arrivalIntervalMs = 2;
    const processingDelayMs = 3;
    expect(processingDelayMs / arrivalIntervalMs).toBe(1.5);

    const { queue, spool } = await createQueue('overload', { maxAttempts: 1 });
    await commitSegments(queue, spool, segmentCount, 30_000);
    const checkpoint = jest.spyOn(queue, 'checkpoint');
    const checkpointController = new TranscriptionCheckpointController({
      queue,
      intervalSegments: 25,
      intervalMs: 60_000,
    });
    let releaseInitialWorkers!: () => void;
    const initialWorkersBlocked = new Promise<void>((resolve) => {
      releaseInitialWorkers = resolve;
    });
    let startedWorkers = 0;
    let markWorkersStarted!: () => void;
    const workersStarted = new Promise<void>((resolve) => {
      markWorkersStarted = resolve;
    });
    const scheduler = new TranscriptionScheduler({
      queue,
      spool,
      concurrency: 3,
      onTerminalJob: () => checkpointController.recordTerminalJob(),
      transcribe: async (job) => {
        startedWorkers += 1;
        if (startedWorkers === 3) markWorkersStarted();
        await initialWorkersBlocked;
        await delay(processingDelayMs);
        if (Number(job.id.slice(4)) % 53 === 0) throw new Error('synthetic permanent failure');
        return `transcript ${job.id}`;
      },
    });

    scheduler.signal();
    await workersStarted;
    const stopStartedAt = Date.now();
    await queue.seal();
    await checkpointController.flush();
    const stopElapsedMs = Date.now() - stopStartedAt;
    const partialStats = queue.stats();
    const partialTranscript = transcript(queue, 'partial');

    expect(stopElapsedMs).toBeLessThan(2_000);
    expect(partialStats.pending).toBeGreaterThan(0);
    expect(partialTranscript).toContain('SPRITEbot Voice Transcript (Partial)');
    releaseInitialWorkers();
    await scheduler.onIdle();
    await checkpointController.stop();

    const stats = queue.stats();
    const results = queue.completedResults();
    const finalTranscript = transcript(queue, 'final');
    expect(queue.isFullyResolved()).toBe(true);
    expect(results).toHaveLength(segmentCount);
    expect(new Set(results.map((result) => result.jobId))).toHaveProperty('size', segmentCount);
    expect(stats.done + stats.dead_letter).toBe(segmentCount);
    expect(checkpoint.mock.calls.length).toBeGreaterThan(10);
    expect(finalTranscript).toContain('SPRITEbot Voice Transcript');
    expect(finalTranscript).toContain('Omitted segments:');
    expect(formatTranscriptionProgress(stats, { phase: 'complete' })).toContain(
      `${stats.done}/${segmentCount} transcribed`,
    );
    const persistedCheckpoint = JSON.parse(
      await readFile(path.join(spool.sessionDir, 'checkpoint.json'), 'utf8'),
    ) as { results: unknown[] };
    expect(persistedCheckpoint.results).toHaveLength(segmentCount);
  }, 30_000);

  test('recovers processing jobs mid-drain without duplicating earlier results', async () => {
    const segmentCount = 24;
    const { queue, spool } = await createQueue('restart', { maxAttempts: 2 });
    await commitSegments(queue, spool, segmentCount, 1_000);
    await queue.seal();
    const beforeCrash = new Set<string>();
    const neverCompletes = new Promise<void>(() => undefined);
    const crashedScheduler = new TranscriptionScheduler({
      queue,
      spool,
      concurrency: 3,
      transcribe: async (job) => {
        if (beforeCrash.size < 5) {
          beforeCrash.add(job.id);
          return `before restart ${job.id}`;
        }
        await neverCompletes;
        return 'unreachable';
      },
    });
    crashedScheduler.signal();
    await waitFor(() => queue.stats().done === 5 && queue.stats().processing === 3);
    await queue.checkpoint();

    const recovered = await recoverFileManifestQueue(spool.sessionDir, {
      maxAttempts: 2,
      retryBaseMs: 1,
      retryMaxMs: 1,
      jitter: () => 0,
    });
    expect(recovered.stats()).toMatchObject({ done: 5, failed: 3 });
    const resumedScheduler = new TranscriptionScheduler({
      queue: recovered,
      spool,
      concurrency: 3,
      transcribe: async (job) => `after restart ${job.id}`,
    });
    resumedScheduler.signal();
    await resumedScheduler.onIdle();
    await recovered.checkpoint();

    const results = recovered.completedResults();
    expect(recovered.isFullyResolved()).toBe(true);
    expect(results).toHaveLength(segmentCount);
    expect(new Set(results.map((result) => result.jobId))).toHaveProperty('size', segmentCount);
    expect(results.filter((result) => result.text?.startsWith('before restart'))).toHaveLength(5);
    expect(results.filter((result) => result.text?.startsWith('after restart'))).toHaveLength(19);
  }, 15_000);

  async function createQueue(sessionId: string, options: { maxAttempts: number }) {
    const spool = new SegmentSpool({ guildId: 'guild', sessionId, baseDir });
    await spool.initialize();
    const queue = await FileManifestQueue.create(
      spool.sessionDir,
      {
        sessionId,
        guildId: 'guild',
        voiceChannelId: 'voice',
        textChannelId: 'text',
        startedAt: '2026-07-20T12:00:00.000Z',
        startedBy: 'user',
      },
      { ...options, retryBaseMs: 1, retryMaxMs: 1, jitter: () => 0 },
    );
    return { queue, spool };
  }
});

async function commitSegments(
  queue: FileManifestQueue,
  spool: SegmentSpool,
  count: number,
  durationMs: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const id = `job-${String(index).padStart(4, '0')}`;
    const spoolPath = await spool.writeSegment({ segmentId: id, wav: Buffer.from(id) });
    await queue.commit({
      id,
      userId: `user-${index % 6}`,
      displayName: `Speaker ${index % 6}`,
      timestamp: new Date(
        Date.parse('2026-07-20T12:00:00.000Z') + index * durationMs,
      ).toISOString(),
      durationMs,
      spoolPath,
    });
  }
}

function transcript(queue: FileManifestQueue, kind: 'partial' | 'final'): string {
  return formatTranscript(
    {
      guildId: queue.header.guildId,
      voiceChannelId: queue.header.voiceChannelId,
      textChannelId: queue.header.textChannelId,
      startedAt: new Date(queue.header.startedAt),
      participants: 6,
      results: queue.completedResults(),
      stats: queue.stats(),
    },
    { endedAt: new Date('2026-07-20T15:00:00.000Z'), kind },
  );
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for transcription state');
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
