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
      transcribe: async () => {
        throw new Error('whisper unavailable');
      },
    });

    await expect(queued.completion).resolves.toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'whisper unavailable',
    });
    expect(queue.snapshot()).toHaveLength(1);
    expect(queue.stats()).toMatchObject({ failed: 1, pending: 0 });
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
