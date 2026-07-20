import { SegmentBuffer } from '../../../src/voice/segment_buffer';

const chunkMs = 20;
const samplesPerChunk = 16_000 * (chunkMs / 1_000);

describe('SegmentBuffer adaptive silence', () => {
  test('applies a widened silence limit to a segment already accumulating', () => {
    const buffer = new SegmentBuffer({ silenceMs: 700, minSegmentMs: 100, maxSegmentMs: 5_000 });
    pushFor(buffer, speechChunk(), 600);
    pushFor(buffer, silenceChunk(), 600);
    buffer.setSilenceLimit(1_500);

    expect(pushFor(buffer, silenceChunk(), 800)).toBeNull();
    expect(pushFor(buffer, silenceChunk(), 100)).toMatchObject({ durationMs: 2_100 });
  });

  test('never exceeds the maximum segment duration after widening silence', () => {
    const buffer = new SegmentBuffer({ silenceMs: 700, minSegmentMs: 100, maxSegmentMs: 1_000 });
    buffer.setSilenceLimit(1_500);
    expect(pushFor(buffer, speechChunk(), 1_000)).toMatchObject({ durationMs: 1_000 });
  });

  test('wider gaps reduce fixed request overhead by producing fewer segments', () => {
    const normal = segmentCount(700);
    const elevated = segmentCount(1_500);
    const fixedRequestOverheadMs = 250;

    expect(normal).toBe(2);
    expect(elevated).toBe(1);
    expect(elevated * fixedRequestOverheadMs).toBeLessThan(normal * fixedRequestOverheadMs);
  });
});

function segmentCount(silenceMs: number): number {
  const buffer = new SegmentBuffer({ silenceMs, minSegmentMs: 100, maxSegmentMs: 10_000 });
  let count = 0;
  for (const [chunk, duration] of [
    [speechChunk(), 600],
    [silenceChunk(), 800],
    [speechChunk(), 600],
    [silenceChunk(), 1_500],
  ] as const) {
    count += pushFor(buffer, chunk, duration) ? 1 : 0;
  }
  count += buffer.flush() ? 1 : 0;
  return count;
}

function pushFor(buffer: SegmentBuffer, chunk: Buffer, durationMs: number) {
  let emitted = null;
  for (let elapsed = 0; elapsed < durationMs; elapsed += chunkMs) {
    emitted = buffer.push(chunk) ?? emitted;
  }
  return emitted;
}

function speechChunk(): Buffer {
  const chunk = Buffer.alloc(samplesPerChunk * 2);
  for (let offset = 0; offset < chunk.length; offset += 2) chunk.writeInt16LE(10_000, offset);
  return chunk;
}

function silenceChunk(): Buffer {
  return Buffer.alloc(samplesPerChunk * 2);
}
