import { TranscriptionWorkerPool } from '../../../src/voice/transcription_worker_pool';

describe('TranscriptionWorkerPool', () => {
  test('shares one concurrency budget across independent callers', async () => {
    const pool = new TranscriptionWorkerPool(2);
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const work = () =>
      pool.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
      });

    const jobs = [work(), work(), work(), work()];
    await new Promise((resolve) => setImmediate(resolve));
    expect(active).toBe(2);
    releases.shift()?.();
    releases.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(active).toBe(2);
    releases.shift()?.();
    releases.shift()?.();
    await Promise.all(jobs);
    expect(peak).toBe(2);
  });
});
