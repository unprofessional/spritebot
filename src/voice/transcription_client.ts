import { transcriptionServiceUrl } from '../config/env_config';

export type TranscriptionResult = {
  text: string;
};

type WhisperJsonResponse = {
  text?: unknown;
  error?: unknown;
};

export class TranscriptionClient {
  constructor(private readonly endpoint = transcriptionServiceUrl) {}

  async transcribeWav(wav: Buffer, filename: string): Promise<TranscriptionResult> {
    const form = new FormData();
    form.set('file', new Blob([wav], { type: 'audio/wav' }), filename);
    form.set('response_format', 'json');
    form.set('temperature', '0.0');
    form.set('no_timestamps', 'true');

    const response = await fetch(this.endpoint, {
      method: 'POST',
      body: form,
    });

    const body = (await response.json().catch(() => null)) as WhisperJsonResponse | null;
    if (!response.ok) {
      const error = typeof body?.error === 'string' ? body.error : response.statusText;
      throw new Error(`Transcription failed (${response.status}): ${error}`);
    }

    return { text: typeof body?.text === 'string' ? body.text.trim() : '' };
  }
}
