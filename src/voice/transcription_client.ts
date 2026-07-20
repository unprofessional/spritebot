import {
  transcriptionRequestRetries,
  transcriptionRequestTimeoutMs,
  transcriptionServiceUrl,
} from '../config/env_config';

export type TranscriptionResult = {
  text: string;
};

type WhisperJsonResponse = {
  text?: unknown;
  error?: unknown;
};

type FetchFn = typeof fetch;

export type TranscriptionClientOptions = {
  endpoint?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
};

class TranscriptionHttpError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = 'TranscriptionHttpError';
  }
}

class TranscriptionTimeoutError extends Error {
  readonly transient = true;

  constructor(timeoutMs: number) {
    super(`Transcription request timed out after ${timeoutMs}ms`);
    this.name = 'TranscriptionTimeoutError';
  }
}

export class TranscriptionClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchFn: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: TranscriptionClientOptions = {}) {
    this.endpoint = options.endpoint ?? transcriptionServiceUrl;
    this.timeoutMs = options.timeoutMs ?? transcriptionRequestTimeoutMs;
    this.maxRetries = Math.max(0, Math.floor(options.maxRetries ?? transcriptionRequestRetries));
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async transcribeWav(wav: Buffer, filename: string): Promise<TranscriptionResult> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.transcribeWavOnce(wav, filename);
      } catch (err) {
        lastError = err;
        if (!isTransientError(err) || attempt >= this.maxRetries) {
          throw err;
        }

        await this.sleep(this.retryDelayMs(attempt));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async transcribeWavOnce(wav: Buffer, filename: string): Promise<TranscriptionResult> {
    const form = new FormData();
    form.set('file', new Blob([wav], { type: 'audio/wav' }), filename);
    form.set('response_format', 'json');
    form.set('temperature', '0.0');
    form.set('no_timestamps', 'true');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(this.endpoint, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new TranscriptionTimeoutError(this.timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    const body = (await response.json().catch(() => null)) as WhisperJsonResponse | null;
    if (!response.ok) {
      const error = typeof body?.error === 'string' ? body.error : response.statusText;
      throw new TranscriptionHttpError(
        `Transcription failed (${response.status}): ${error}`,
        isTransientStatus(response.status),
      );
    }

    return { text: typeof body?.text === 'string' ? body.text.trim() : '' };
  }

  private retryDelayMs(attempt: number): number {
    return this.retryBaseDelayMs * 2 ** attempt;
  }
}

function isTransientError(err: unknown): boolean {
  if (err instanceof TranscriptionHttpError) {
    return err.transient;
  }
  if (err instanceof TranscriptionTimeoutError) {
    return true;
  }
  if (err instanceof TypeError) {
    return true;
  }

  return false;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
