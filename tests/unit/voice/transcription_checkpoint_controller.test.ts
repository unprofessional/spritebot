import type { TranscriptionJobQueue } from '../../../src/voice/durable_queue/types';
import { TranscriptionCheckpointController } from '../../../src/voice/transcription_checkpoint_controller';

describe('TranscriptionCheckpointController', () => {
  afterEach(() => jest.useRealTimers());

  test('checkpoints after the configured number of terminal jobs', async () => {
    const checkpoint = jest.fn().mockResolvedValue(undefined);
    const controller = new TranscriptionCheckpointController({
      queue: { checkpoint } as unknown as TranscriptionJobQueue,
      intervalSegments: 2,
      intervalMs: 60_000,
    });

    controller.recordTerminalJob();
    expect(checkpoint).not.toHaveBeenCalled();
    controller.recordTerminalJob();
    await controller.stop();

    expect(checkpoint).toHaveBeenCalledTimes(2);
  });

  test('checkpoints on the time interval and flushes on stop', async () => {
    jest.useFakeTimers();
    const checkpoint = jest.fn().mockResolvedValue(undefined);
    const controller = new TranscriptionCheckpointController({
      queue: { checkpoint } as unknown as TranscriptionJobQueue,
      intervalSegments: 50,
      intervalMs: 1_000,
    });

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(checkpoint).toHaveBeenCalledTimes(1);
    await controller.stop();
    expect(checkpoint).toHaveBeenCalledTimes(2);
  });

  test('reports checkpoint failures without disabling later checkpoints', async () => {
    const onError = jest.fn();
    const checkpoint = jest
      .fn()
      .mockRejectedValueOnce(new Error('disk'))
      .mockResolvedValue(undefined);
    const controller = new TranscriptionCheckpointController({
      queue: { checkpoint } as unknown as TranscriptionJobQueue,
      intervalSegments: 1,
      intervalMs: 60_000,
      onError,
    });

    controller.recordTerminalJob();
    await controller.flush();
    await controller.stop();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk' }));
    expect(checkpoint).toHaveBeenCalledTimes(3);
  });
});
