import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { FileManifestQueue } from '../../../src/voice/durable_queue/file_manifest_queue';
import { recoverTranscriptionSessions } from '../../../src/voice/durable_queue/recovery';
import { SegmentSpool } from '../../../src/voice/segment_spool';

describe('transcription restart recovery', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), 'spritebot-recovery-test-'));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  test('resets claimed work, skips acknowledged work, seals capture, and completes', async () => {
    const { queue, spool } = await createQueue('resume');
    const donePath = await spool.writeSegment({ segmentId: 'done', wav: Buffer.from('done') });
    await queue.commit(job('done', donePath));
    await queue.claim();
    await queue.ack('done', 'already complete');
    await spool.deleteSegment(donePath);
    const pendingPath = await spool.writeSegment({
      segmentId: 'pending',
      wav: Buffer.from('pending'),
    });
    await queue.commit(job('pending', pendingPath));
    await queue.claim();

    const transcribe = jest.fn(async (_header, claimed, wav: Buffer) => {
      return `${claimed.id}:${wav.toString()}`;
    });
    const onRecovered = jest.fn().mockResolvedValue(undefined);
    const onCompleted = jest.fn().mockResolvedValue(undefined);
    const handles = await recover({ transcribe, onRecovered, onCompleted });
    await Promise.all(handles.map((handle) => handle.completion));

    expect(handles).toHaveLength(1);
    expect(handles[0].interrupted).toBe(true);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0][1]).toMatchObject({ id: 'pending', attempts: 2 });
    expect(handles[0].queue.completedResults()).toEqual([
      expect.objectContaining({ jobId: 'done', text: 'already complete' }),
      expect.objectContaining({ jobId: 'pending', text: 'pending:pending' }),
    ]);
    expect(onRecovered).toHaveBeenCalledWith(handles[0].queue, true);
    expect(onCompleted).toHaveBeenCalledWith(handles[0].queue, true);
  });

  test('notifies and finalizes an interrupted session whose jobs were already terminal', async () => {
    const { queue, spool } = await createQueue('terminal');
    const spoolPath = await spool.writeSegment({ segmentId: 'done', wav: Buffer.from('wav') });
    await queue.commit(job('done', spoolPath));
    await queue.claim();
    await queue.ack('done', 'text');
    await spool.deleteSegment(spoolPath);
    const onRecovered = jest.fn().mockResolvedValue(undefined);
    const onCompleted = jest.fn().mockResolvedValue(undefined);

    const handles = await recover({ onRecovered, onCompleted });
    await Promise.all(handles.map((handle) => handle.completion));

    expect(handles).toHaveLength(1);
    expect(handles[0].queue.isFullyResolved()).toBe(true);
    expect(onRecovered).toHaveBeenCalledWith(handles[0].queue, true);
    expect(onCompleted).toHaveBeenCalledWith(handles[0].queue, true);
  });

  test('deletes only resolved sessions past retention using durable resolvedAt', async () => {
    const oldNow = () => new Date('2026-07-01T00:00:00.000Z');
    const { queue, spool } = await createQueue('expired', oldNow);
    const spoolPath = await spool.writeSegment({ segmentId: 'done', wav: Buffer.from('wav') });
    await queue.commit(job('done', spoolPath));
    await queue.claim();
    await queue.ack('done', 'text');
    await queue.seal();
    const sessionDir = spool.sessionDir;

    const handles = await recover({
      retentionHours: 24,
      now: () => new Date('2026-07-20T00:00:00.000Z'),
    });

    expect(handles).toHaveLength(0);
    await expect(access(sessionDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('retains old unresolved sessions and skips corrupt manifests', async () => {
    const { queue, spool } = await createQueue(
      'old-unresolved',
      () => new Date('2026-07-01T00:00:00.000Z'),
    );
    const spoolPath = await spool.writeSegment({ segmentId: 'pending', wav: Buffer.from('wav') });
    await queue.commit(job('pending', spoolPath));
    const corruptDir = path.join(baseDir, 'corrupt');
    await mkdir(corruptDir);
    await writeFile(path.join(corruptDir, 'manifest.jsonl'), 'not-json\n');
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const handles = await recover({
      retentionHours: 24,
      now: () => new Date('2026-07-20T00:00:00.000Z'),
      logger,
    });
    await Promise.all(handles.map((handle) => handle.completion));

    expect(handles).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('past retention'));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('corrupt'),
      expect.anything(),
    );
    await expect(access(spool.sessionDir)).resolves.toBeUndefined();
  });

  test('does not scan when this process is not the active lease holder', async () => {
    await createQueue('standby');
    const transcribe = jest.fn(async () => 'text');
    const handles = await recover({ activeLeaseHolder: false, transcribe });
    expect(handles).toEqual([]);
    expect(transcribe).not.toHaveBeenCalled();
  });

  test('caps concurrent recovery per guild and leaves excess sessions for a later scan', async () => {
    await createPendingQueue('recovery-a');
    await createPendingQueue('recovery-b');
    const deferred = await createPendingQueue('recovery-c');
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const onRecovered = jest.fn().mockResolvedValue(undefined);

    const firstHandles = await recover({ logger, onRecovered });
    await Promise.all(firstHandles.map((handle) => handle.completion));

    expect(firstHandles).toHaveLength(2);
    expect(onRecovered).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'deferred transcription recovery because guild concurrency cap was reached',
      ),
    );
    await expect(access(deferred.spool.sessionDir)).resolves.toBeUndefined();

    const secondHandles = await recover({ logger, onRecovered });
    await Promise.all(secondHandles.map((handle) => handle.completion));

    expect(secondHandles).toHaveLength(1);
    expect(secondHandles[0].queue.header.sessionId).toBe('recovery-c');
  });

  async function createQueue(sessionId: string, now: () => Date = () => new Date()) {
    const spool = new SegmentSpool({ guildId: 'guild', sessionId, baseDir });
    await spool.initialize();
    const queue = await FileManifestQueue.create(
      spool.sessionDir,
      {
        sessionId,
        guildId: 'guild',
        voiceChannelId: 'voice',
        textChannelId: 'text',
        startedAt: now().toISOString(),
        startedBy: 'starter',
      },
      { maxAttempts: 3, retryBaseMs: 1, retryMaxMs: 1, jitter: () => 0, now },
    );
    return { queue, spool };
  }

  async function createPendingQueue(sessionId: string) {
    const created = await createQueue(sessionId);
    const spoolPath = await created.spool.writeSegment({
      segmentId: `${sessionId}-pending`,
      wav: Buffer.from(sessionId),
    });
    await created.queue.commit(job(`${sessionId}-pending`, spoolPath));
    return created;
  }

  function recover(overrides: Record<string, unknown> = {}) {
    return recoverTranscriptionSessions({
      activeLeaseHolder: true,
      baseDir,
      queueOptions: { maxAttempts: 3, retryBaseMs: 1, retryMaxMs: 1, jitter: () => 0 },
      concurrency: 2,
      retentionHours: 72,
      checkpointIntervalSegments: 2,
      checkpointIntervalMs: 60_000,
      isDraining: () => false,
      transcribe: async (_header, claimed, wav) => `${claimed.id}:${wav.toString()}`,
      onRecovered: async () => undefined,
      onCompleted: async () => undefined,
      ...overrides,
    });
  }
});

function job(id: string, spoolPath: string) {
  return {
    id,
    userId: 'user',
    displayName: 'Mads',
    timestamp: '2026-07-01T00:00:01.000Z',
    durationMs: 1_000,
    spoolPath,
  };
}
