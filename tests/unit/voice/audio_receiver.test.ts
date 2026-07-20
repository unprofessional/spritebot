import { transcriptionBackpressureSilenceMs } from '../../../src/config/env_config';
import { receiverSilenceDurationMs } from '../../../src/voice/audio_receiver';

describe('AudioReceiver segmentation boundary', () => {
  test('keeps Discord streams open beyond the elevated buffer silence threshold', () => {
    expect(receiverSilenceDurationMs).toBeGreaterThan(transcriptionBackpressureSilenceMs);
    expect(receiverSilenceDurationMs).toBeGreaterThanOrEqual(2_000);
  });
});
