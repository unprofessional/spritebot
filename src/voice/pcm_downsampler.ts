import { Transform, TransformCallback } from 'node:stream';

const INPUT_SAMPLE_RATE = 48_000;
const OUTPUT_SAMPLE_RATE = 16_000;
const INPUT_CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const DOWNSAMPLE_RATIO = INPUT_SAMPLE_RATE / OUTPUT_SAMPLE_RATE;
const INPUT_FRAME_BYTES = INPUT_CHANNELS * BYTES_PER_SAMPLE;
const OUTPUT_SAMPLE_BYTES = BYTES_PER_SAMPLE;

export class Pcm48StereoTo16Mono extends Transform {
  private pending = Buffer.alloc(0);

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const input = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const completeFrames = Math.floor(input.length / INPUT_FRAME_BYTES);
    const outputSamples = Math.floor(completeFrames / DOWNSAMPLE_RATIO);
    const output = Buffer.alloc(outputSamples * OUTPUT_SAMPLE_BYTES);

    for (let i = 0; i < outputSamples; i += 1) {
      let sum = 0;
      for (let j = 0; j < DOWNSAMPLE_RATIO; j += 1) {
        const frameOffset = (i * DOWNSAMPLE_RATIO + j) * INPUT_FRAME_BYTES;
        const left = input.readInt16LE(frameOffset);
        const right = input.readInt16LE(frameOffset + BYTES_PER_SAMPLE);
        sum += (left + right) / 2;
      }

      const sample = Math.max(-32768, Math.min(32767, Math.round(sum / DOWNSAMPLE_RATIO)));
      output.writeInt16LE(sample, i * OUTPUT_SAMPLE_BYTES);
    }

    const consumedBytes = outputSamples * DOWNSAMPLE_RATIO * INPUT_FRAME_BYTES;
    this.pending = input.subarray(consumedBytes);
    this.push(output);
    callback();
  }
}
