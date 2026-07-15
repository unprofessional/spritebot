import { TranscriptionQueue } from '../../../src/voice/transcription_queue';

describe('TranscriptionQueue', () => {
  test('enforces the configured concurrency limit', async () => {
    const queue = new TranscriptionQueue({ concurrency: 2 });
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;

    const enqueued = Array.from({ length: 5 }, (_, index) =>
      queue.enqueue({
        userId: `user-${index}`,
        timestamp: new Date(index),
        durationMs: 1_000,
        transcribe: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise<void>((resolve) => {
            releases.push(() => {
              active -= 1;
              resolve();
            });
          });
          return `segment ${index}`;
        },
      }),
    );

    await flushPromises();
    expect(maxActive).toBe(2);
    expect(queue.stats()).toMatchObject({ active: 2, pending: 5, queued: 3 });

    while (releases.length > 0) {
      releases.shift()?.();
      await flushPromises();
    }

    await Promise.all(enqueued.map((item) => item.completion));
    expect(maxActive).toBe(2);
    expect(queue.stats()).toMatchObject({ active: 0, pending: 0, done: 5, failed: 0 });
  });

  test('records failed segment status and error text', async () => {
    const queue = new TranscriptionQueue({ concurrency: 1 });
    const queued = queue.enqueue({
      userId: 'user-1',
      timestamp: new Date('2026-07-15T00:00:00.000Z'),
      durationMs: 1_000,
      diskPath: '/tmp/spritebot-voice/session/segment.wav',
      transcribe: async () => {
        throw new Error('whisper unavailable');
      },
    });

    await expect(queued.completion).resolves.toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'whisper unavailable',
      diskPath: '/tmp/spritebot-voice/session/segment.wav',
    });
    expect(queue.snapshot()).toHaveLength(1);
    expect(queue.stats()).toMatchObject({ failed: 1, pending: 0 });
  });

  test('marks unfinished queued and active segments as timed out', async () => {
    const queue = new TranscriptionQueue({ concurrency: 1 });
    const releaseActive = deferred<string | null>();
    const active = queue.enqueue({
      userId: 'user-1',
      timestamp: new Date('2026-07-15T00:00:00.000Z'),
      durationMs: 1_000,
      transcribe: () => releaseActive.promise,
    });
    const queued = queue.enqueue({
      userId: 'user-2',
      timestamp: new Date('2026-07-15T00:00:01.000Z'),
      durationMs: 1_000,
      transcribe: async () => 'too late',
    });
    await flushPromises();

    expect(queue.markUnfinishedTimedOut('drain timed out')).toBe(2);
    await expect(queued.completion).resolves.toMatchObject({
      status: 'timeout',
      lastError: 'drain timed out',
    });

    releaseActive.resolve('late transcript');
    await expect(active.completion).resolves.toMatchObject({
      status: 'timeout',
      result: null,
      lastError: 'drain timed out',
    });
    expect(queue.stats()).toMatchObject({ timeout: 2, pending: 0 });
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
