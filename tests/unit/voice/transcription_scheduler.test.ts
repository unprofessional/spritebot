import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { FileManifestQueue } from '../../../src/voice/durable_queue/file_manifest_queue';
import { SegmentSpool } from '../../../src/voice/segment_spool';
import { TranscriptionScheduler } from '../../../src/voice/transcription_scheduler';

describe('TranscriptionScheduler', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), 'spritebot-scheduler-test-'));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  test('processes a committed WAV, records its result, and deletes only the WAV', async () => {
    const { queue, spool, spoolPath } = await fixture();
    const scheduler = new TranscriptionScheduler({
      queue,
      spool,
      concurrency: 1,
      transcribe: async (_job, wav) => `heard ${wav.toString()}`,
    });

    scheduler.signal();
    await scheduler.onIdle();

    expect(queue.completedResults()).toEqual([
      expect.objectContaining({ jobId: 'job-1', status: 'done', text: 'heard wav-data' }),
    ]);
    await expect(access(path.join(spool.sessionDir, spoolPath))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(access(path.join(spool.sessionDir, 'manifest.jsonl'))).resolves.toBeUndefined();
  });

  test('retries a transient failure after its durable eligibility time', async () => {
    const { queue, spool } = await fixture({ retryBaseMs: 5 });
    const transcribe = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce('recovered');
    const scheduler = new TranscriptionScheduler({
      queue,
      spool,
      concurrency: 1,
      transcribe,
    });

    scheduler.signal();
    await scheduler.onIdle();

    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(queue.stats()).toMatchObject({ done: 1, dead_letter: 0, pending: 0 });
  });

  test('dead-letters exhausted work while continuing other jobs', async () => {
    const { queue, spool } = await fixture({ maxAttempts: 1 });
    const secondPath = await spool.writeSegment({ segmentId: 'job-2', wav: Buffer.from('two') });
    await queue.commit(job('job-2', secondPath));
    const scheduler = new TranscriptionScheduler({
      queue,
      spool,
      concurrency: 1,
      transcribe: async (claimed) => {
        if (claimed.id === 'job-1') throw new Error('permanent');
        return 'second result';
      },
    });

    scheduler.signal();
    await scheduler.onIdle();

    expect(queue.stats()).toMatchObject({ done: 1, dead_letter: 1, pending: 0 });
    await expect(access(path.join(spool.sessionDir, 'segment-job-1.wav'))).resolves.toBeUndefined();
    await expect(access(path.join(spool.sessionDir, secondPath))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('does not claim new work while runtime draining is active', async () => {
    const { queue, spool } = await fixture();
    const transcribe = jest.fn(async () => 'ignored');
    const scheduler = new TranscriptionScheduler({
      queue,
      spool,
      concurrency: 1,
      transcribe,
      isDraining: () => true,
    });
    scheduler.signal();
    await new Promise((resolve) => setImmediate(resolve));
    expect(transcribe).not.toHaveBeenCalled();
    expect(queue.stats()).toMatchObject({ committed: 1, processing: 0 });
  });

  test('does not exceed its worker concurrency', async () => {
    const { queue, spool } = await fixture();
    for (const id of ['job-2', 'job-3']) {
      const spoolPath = await spool.writeSegment({ segmentId: id, wav: Buffer.from(id) });
      await queue.commit(job(id, spoolPath));
    }
    let active = 0;
    let peak = 0;
    let releaseWorkers: (() => void) | undefined;
    const workersStarted = new Promise<void>((resolve) => {
      releaseWorkers = resolve;
    });
    const scheduler = new TranscriptionScheduler({
      queue,
      spool,
      concurrency: 2,
      transcribe: async () => {
        active += 1;
        peak = Math.max(peak, active);
        if (active === 2) releaseWorkers?.();
        await workersStarted;
        active -= 1;
        return 'done';
      },
    });
    scheduler.signal();
    await scheduler.onIdle();
    expect(peak).toBe(2);
  });

  async function fixture(options: { maxAttempts?: number; retryBaseMs?: number } = {}) {
    const spool = new SegmentSpool({ guildId: 'guild', sessionId: 'session', baseDir });
    await spool.initialize();
    const queue = await FileManifestQueue.create(
      spool.sessionDir,
      {
        sessionId: 'session',
        guildId: 'guild',
        voiceChannelId: 'voice',
        textChannelId: 'text',
        startedAt: '2026-07-20T00:00:00.000Z',
        startedBy: 'user',
      },
      {
        maxAttempts: options.maxAttempts ?? 2,
        retryBaseMs: options.retryBaseMs ?? 1,
        retryMaxMs: options.retryBaseMs ?? 1,
        jitter: () => 0,
      },
    );
    const spoolPath = await spool.writeSegment({
      segmentId: 'job-1',
      wav: Buffer.from('wav-data'),
    });
    await queue.commit(job('job-1', spoolPath));
    return { queue, spool, spoolPath };
  }
});

function job(id: string, spoolPath: string) {
  return {
    id,
    userId: 'user-1',
    displayName: 'Mads',
    timestamp: '2026-07-20T00:00:01.000Z',
    durationMs: 1_000,
    spoolPath,
  };
}
