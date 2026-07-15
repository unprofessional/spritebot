import { TranscriptionClient } from '../../../src/voice/transcription_client';

describe('TranscriptionClient', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('aborts requests after the configured timeout', async () => {
    jest.useFakeTimers();

    const fetchFn = jest.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });
    const client = new TranscriptionClient({
      endpoint: 'http://transcription.test/inference',
      timeoutMs: 50,
      maxRetries: 0,
      fetchFn,
    });

    const request = client.transcribeWav(Buffer.from('wav'), 'clip.wav');
    const expectation = expect(request).rejects.toThrow('timed out after 50ms');
    await jest.advanceTimersByTimeAsync(50);

    await expectation;
  });

  test('retries transient server failures', async () => {
    const fetchFn = jest
      .fn<Promise<Response>, [string | URL | Request, RequestInit | undefined]>()
      .mockResolvedValueOnce(jsonResponse({ error: 'warming up' }, 503))
      .mockResolvedValueOnce(jsonResponse({ text: ' hello ' }, 200));
    const sleep = jest.fn(() => Promise.resolve());
    const client = new TranscriptionClient({
      endpoint: 'http://transcription.test/inference',
      maxRetries: 2,
      retryBaseDelayMs: 10,
      fetchFn,
      sleep,
    });

    await expect(client.transcribeWav(Buffer.from('wav'), 'clip.wav')).resolves.toEqual({
      text: 'hello',
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  test('does not retry permanent client errors', async () => {
    const fetchFn = jest
      .fn<Promise<Response>, [string | URL | Request, RequestInit | undefined]>()
      .mockResolvedValue(jsonResponse({ error: 'bad audio' }, 400));
    const client = new TranscriptionClient({
      endpoint: 'http://transcription.test/inference',
      maxRetries: 2,
      fetchFn,
    });

    await expect(client.transcribeWav(Buffer.from('wav'), 'clip.wav')).rejects.toThrow(
      'Transcription failed (400): bad audio',
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
