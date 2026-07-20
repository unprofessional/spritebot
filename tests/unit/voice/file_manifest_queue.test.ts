import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  FileManifestQueue,
  recoverFileManifestQueue,
} from '../../../src/voice/durable_queue/file_manifest_queue';
import type { FileManifestQueueOptions, SegmentJob } from '../../../src/voice/durable_queue/types';

describe('FileManifestQueue', () => {
  let rootDir: string;
  let sessionDir: string;
  let nowMs: number;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'spritebot-manifest-test-'));
    sessionDir = path.join(rootDir, 'session');
    nowMs = Date.parse('2026-07-20T12:00:00.000Z');
  });

  afterEach(async () => {
    await chmod(path.join(sessionDir, 'manifest.jsonl'), 0o600).catch(() => undefined);
    await rm(rootDir, { recursive: true, force: true });
  });

  test('commits, claims, acknowledges, checkpoints, and resolves a sealed queue', async () => {
    const queue = await createQueue();
    const job = segment('job-1', 'segment-job-1.wav');
    await writeWav(job.spoolPath);

    await queue.commit(job);
    await queue.addParticipant(job.userId, job.displayName);
    await expect(queue.claim()).resolves.toMatchObject({ id: job.id, attempts: 1 });
    await queue.ack(job.id, 'hello world');
    expect(queue.isFullyResolved()).toBe(false);

    await queue.seal();
    await queue.checkpoint();

    expect(queue.isFullyResolved()).toBe(true);
    expect(queue.stats()).toMatchObject({ done: 1, pending: 0, sealed: true });
    expect(queue.completedResults()).toEqual([
      expect.objectContaining({ jobId: job.id, status: 'done', text: 'hello world' }),
    ]);
    expect((await events()).filter((event) => event.type === 'resolved')).toHaveLength(1);
    const checkpoint = JSON.parse(
      await readFile(path.join(sessionDir, 'checkpoint.json'), 'utf8'),
    ) as { throughEventSeq: number };
    expect(checkpoint.throughEventSeq).toBe(queue.stats().resolvedAt ? 6 : -1);
  });

  test('serializes concurrent commits and claims without duplication', async () => {
    const queue = await createQueue();
    const jobs = Array.from({ length: 20 }, (_, index) =>
      segment(`job-${index}`, `segment-job-${index}.wav`, index),
    );
    await Promise.all(jobs.map((job) => queue.commit(job)));

    const claims = await Promise.all(Array.from({ length: 20 }, () => queue.claim()));
    expect(new Set(claims.map((claim) => claim?.id)).size).toBe(20);
    expect(queue.stats()).toMatchObject({ processing: 20, total: 20 });
  });

  test('applies durable retry backoff and dead letters at max attempts', async () => {
    const queue = await createQueue({ maxAttempts: 2, retryBaseMs: 30_000, retryMaxMs: 60_000 });
    const job = segment('retry-job', 'retry.wav');
    await queue.commit(job);
    await queue.claim();
    await queue.nack(job.id, 'service unavailable');

    expect(queue.nextEligibleAt()).toBe('2026-07-20T12:00:30.000Z');
    await expect(queue.claim()).resolves.toBeNull();
    nowMs += 29_999;
    await expect(queue.claim()).resolves.toBeNull();
    nowMs += 1;
    await expect(queue.claim()).resolves.toMatchObject({ id: job.id, attempts: 2 });
    await queue.nack(job.id, 'still unavailable');

    expect(queue.stats()).toMatchObject({ dead_letter: 1, failed: 0 });
    expect(queue.nextEligibleAt()).toBeNull();
    await expect(queue.claim()).resolves.toBeNull();
  });

  test('sealing an empty queue records one resolution without read-side writes', async () => {
    const queue = await createQueue();
    expect(queue.isFullyResolved()).toBe(false);
    await queue.seal();
    expect(queue.isFullyResolved()).toBe(true);
    expect(queue.isFullyResolved()).toBe(true);
    expect((await events()).map((event) => event.type)).toEqual(['seal', 'resolved']);
    await expect(queue.commit(segment('late', 'late.wav'))).rejects.toThrow('sealed');
  });

  test('recovers a claimed job, seals interrupted capture, and resumes it', async () => {
    const queue = await createQueue();
    const job = segment('crash-job', 'crash.wav');
    await writeWav(job.spoolPath);
    await queue.commit(job);
    await queue.claim();

    const recovered = await recoverFileManifestQueue(sessionDir, options());

    expect(recovered.stats().sealed).toBe(true);
    await expect(recovered.claim()).resolves.toMatchObject({ id: job.id, attempts: 2 });
    const eventTypes = (await events()).map((event) => event.type);
    expect(eventTypes).toContain('recovery_reset');
    expect(eventTypes).toContain('recovery_seal');
  });

  test('repairs a missing resolved event after a crash boundary', async () => {
    const queue = await createQueue();
    const job = segment('resolved-job', 'resolved.wav');
    await queue.commit(job);
    await queue.claim();
    await queue.ack(job.id, 'done');
    await queue.seal();

    const lines = (await readFile(manifestPath(), 'utf8')).trimEnd().split('\n');
    expect(JSON.parse(lines.at(-1) ?? '{}')).toMatchObject({ type: 'resolved' });
    await writeFile(manifestPath(), `${lines.slice(0, -1).join('\n')}\n`, { mode: 0o600 });

    const recovered = await recoverFileManifestQueue(sessionDir, options());
    expect(recovered.isFullyResolved()).toBe(true);
    expect((await events()).filter((event) => event.type === 'resolved')).toHaveLength(1);
  });

  test('truncates an incomplete trailing event before recovery appends', async () => {
    const queue = await createQueue();
    await queue.commit(segment('job-1', 'one.wav'));
    await appendFile(manifestPath(), '{"eventSeq":2,"type":"claim"');

    const recovered = await recoverFileManifestQueue(sessionDir, options());

    expect(recovered.stats()).toMatchObject({ committed: 1, sealed: true });
    const raw = await readFile(manifestPath(), 'utf8');
    expect(raw).not.toContain('{"eventSeq":2,"type":"claim"');
    expect(() =>
      raw
        .trimEnd()
        .split('\n')
        .forEach((line) => JSON.parse(line)),
    ).not.toThrow();
  });

  test('discards a complete-looking event without a durable newline boundary', async () => {
    const queue = await createQueue();
    await queue.commit(segment('job-1', 'one.wav'));
    await appendFile(
      manifestPath(),
      JSON.stringify({ eventSeq: 2, at: new Date(nowMs).toISOString(), type: 'seal' }),
    );

    const recovered = await recoverFileManifestQueue(sessionDir, options());

    expect(recovered.stats()).toMatchObject({ committed: 1, sealed: true });
    expect((await events()).filter((event) => event.type === 'recovery_seal')).toHaveLength(1);
  });

  test('compacts without changing state and continues event sequencing', async () => {
    const queue = await createQueue();
    const job = segment('compact-job', 'compact.wav');
    await queue.commit(job);
    await queue.claim();
    await queue.ack(job.id, 'compacted');
    await queue.compact();
    await queue.seal();

    const recovered = await recoverFileManifestQueue(sessionDir, options());
    expect(recovered.completedResults()).toEqual([
      expect.objectContaining({ jobId: job.id, text: 'compacted' }),
    ]);
    expect(recovered.isFullyResolved()).toBe(true);
  });

  test('serializes acknowledgements, checkpointing, and compaction races', async () => {
    const queue = await createQueue();
    const jobs = Array.from({ length: 5 }, (_, index) =>
      segment(`race-${index}`, `race-${index}.wav`, index),
    );
    await Promise.all(jobs.map((job) => queue.commit(job)));
    await Promise.all(jobs.map(() => queue.claim()));

    await Promise.all([
      ...jobs.map((job) => queue.ack(job.id, `result-${job.id}`)),
      queue.checkpoint(),
      queue.compact(),
    ]);
    await queue.seal();

    const recovered = await recoverFileManifestQueue(sessionDir, options());
    expect(recovered.stats()).toMatchObject({ done: 5, pending: 0 });
    expect(recovered.completedResults()).toHaveLength(5);
  });

  test('rebuilds a corrupt or stale checkpoint from manifest state', async () => {
    const queue = await createQueue();
    const job = segment('checkpoint-job', 'checkpoint.wav');
    await queue.commit(job);
    await queue.claim();
    await queue.ack(job.id, 'checkpoint result');
    await writeFile(path.join(sessionDir, 'checkpoint.json'), '{broken', { mode: 0o600 });

    const recovered = await recoverFileManifestQueue(sessionDir, options());
    const checkpoint = JSON.parse(
      await readFile(path.join(sessionDir, 'checkpoint.json'), 'utf8'),
    ) as { results: Array<{ text: string }> };

    expect(recovered.completedResults()).toHaveLength(1);
    expect(checkpoint.results).toEqual([expect.objectContaining({ text: 'checkpoint result' })]);
  });

  test('retains and reports orphan WAVs during recovery', async () => {
    const queue = await createQueue();
    await queue.commit(segment('known-job', 'known.wav'));
    await writeWav('orphan.wav');
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await recoverFileManifestQueue(sessionDir, options());

    expect(warning).toHaveBeenCalledWith(expect.stringContaining('orphan.wav'));
    await expect(readFile(path.join(sessionDir, 'orphan.wav'))).resolves.toEqual(
      Buffer.from('wav'),
    );
    warning.mockRestore();
  });

  test('deletes a done WAV left behind after an acknowledged crash', async () => {
    const queue = await createQueue();
    const job = segment('done-job', 'done.wav');
    await writeWav(job.spoolPath);
    await queue.commit(job);
    await queue.claim();
    await queue.ack(job.id, 'done');

    await recoverFileManifestQueue(sessionDir, options());

    await expect(readFile(path.join(sessionDir, job.spoolPath))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('rejects traversal paths and symlink escapes', async () => {
    const queue = await createQueue();
    await expect(queue.commit(segment('escape', '../escape.wav'))).rejects.toThrow('escapes');

    const target = path.join(rootDir, 'outside.wav');
    await writeFile(target, 'outside');
    await symlink(target, path.join(sessionDir, 'linked.wav'));
    await queue.commit(segment('linked', 'linked.wav'));
    await expect(recoverFileManifestQueue(sessionDir, options())).rejects.toThrow('symbolic link');
  });

  test('poisons the queue after an uncertain manifest append failure', async () => {
    const queue = await createQueue();
    await rm(manifestPath());
    await mkdir(manifestPath());

    await expect(queue.commit(segment('first', 'first.wav'))).rejects.toThrow(
      'Manifest WAL write is uncertain',
    );
    await rm(manifestPath(), { recursive: true });
    await writeFile(manifestPath(), `${JSON.stringify(queue.header)}\n`, { mode: 0o600 });
    await expect(queue.commit(segment('second', 'second.wav'))).rejects.toThrow(
      'Manifest WAL write is uncertain',
    );
  });

  test('records dropped captures as ordered transcript gaps', async () => {
    const queue = await createQueue();
    await queue.recordDroppedCapture({
      id: 'drop-1',
      userId: 'user-1',
      displayName: 'Speaker',
      timestamp: '2026-07-20T12:00:00.000Z',
      durationMs: 1000,
      reason: 'critical disk pressure',
    });

    expect(queue.stats().dropped).toBe(1);
    expect(queue.completedResults()).toEqual([
      expect.objectContaining({ status: 'capture_dropped', error: 'critical disk pressure' }),
    ]);
  });

  async function createQueue(
    overrides: Partial<FileManifestQueueOptions> = {},
  ): Promise<FileManifestQueue> {
    return FileManifestQueue.create(
      sessionDir,
      {
        sessionId: 'session-1',
        guildId: 'guild-1',
        voiceChannelId: 'voice-1',
        textChannelId: 'text-1',
        startedAt: '2026-07-20T12:00:00.000Z',
        startedBy: 'owner-1',
      },
      options(overrides),
    );
  }

  function options(overrides: Partial<FileManifestQueueOptions> = {}): FileManifestQueueOptions {
    return {
      maxAttempts: 3,
      retryBaseMs: 30_000,
      retryMaxMs: 60_000,
      now: () => new Date(nowMs),
      jitter: () => 0.5,
      ...overrides,
    };
  }

  function segment(id: string, spoolPath: string, offsetSeconds = 0): SegmentJob {
    return {
      id,
      userId: 'user-1',
      displayName: 'Speaker',
      timestamp: new Date(nowMs + offsetSeconds * 1000).toISOString(),
      durationMs: 1000,
      spoolPath,
    };
  }

  async function writeWav(relativePath: string): Promise<void> {
    await writeFile(path.join(sessionDir, relativePath), Buffer.from('wav'), { mode: 0o600 });
  }

  function manifestPath(): string {
    return path.join(sessionDir, 'manifest.jsonl');
  }

  async function events(): Promise<Array<{ type?: string }>> {
    return (await readFile(manifestPath(), 'utf8'))
      .trimEnd()
      .split('\n')
      .slice(1)
      .map((line) => JSON.parse(line) as { type?: string })
      .filter((record) => record.type);
  }
});

describe('durable queue file permissions', () => {
  test('creates session and manifest with restrictive modes', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'spritebot-permissions-test-'));
    const sessionDir = path.join(rootDir, 'session');
    try {
      await FileManifestQueue.create(
        sessionDir,
        {
          sessionId: 'session',
          guildId: 'guild',
          voiceChannelId: 'voice',
          textChannelId: 'text',
          startedAt: new Date().toISOString(),
          startedBy: 'owner',
        },
        { maxAttempts: 3 },
      );
      expect((await stat(sessionDir)).mode & 0o777).toBe(0o700);
      expect((await stat(path.join(sessionDir, 'manifest.jsonl'))).mode & 0o777).toBe(0o600);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
