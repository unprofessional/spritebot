import { classifyDiscordError, DiscordOperationTimeoutError } from '../../../src/discord/errors';

describe('classifyDiscordError', () => {
  test('classifies an expired interaction as permanent', () => {
    const result = classifyDiscordError(
      Object.assign(new Error('Unknown interaction'), { code: 10062, status: 404 }),
    );

    expect(result).toEqual({
      category: 'interaction_expired',
      retryable: false,
      code: 10062,
      status: 404,
      safeMessage: 'Discord interaction expired.',
    });
  });

  test('classifies an already acknowledged interaction as permanent', () => {
    const result = classifyDiscordError(
      Object.assign(new Error('Interaction already acknowledged'), { code: 40060, status: 400 }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        category: 'interaction_already_acknowledged',
        retryable: false,
        code: 40060,
        status: 400,
      }),
    );
  });

  test('classifies a rate limit as retryable only with a supplied safe delay', () => {
    expect(classifyDiscordError({ status: 429, retry_after: 0.25 })).toEqual(
      expect.objectContaining({
        category: 'rate_limited',
        retryable: true,
        status: 429,
        retryAfterMs: 250,
      }),
    );
    expect(classifyDiscordError({ status: 429 })).toEqual(
      expect.objectContaining({
        category: 'rate_limited',
        retryable: false,
        status: 429,
      }),
    );
  });

  test.each([401, 403])('classifies HTTP %i as a permanent permission failure', (status) => {
    expect(classifyDiscordError({ status })).toEqual(
      expect.objectContaining({
        category: 'authentication_or_permission',
        retryable: false,
        status,
      }),
    );
  });

  test('classifies HTTP 5xx as a retryable transient failure', () => {
    expect(classifyDiscordError({ status: 503 })).toEqual({
      category: 'transient_network',
      retryable: true,
      status: 503,
      safeMessage: 'Transient Discord server failure.',
    });
  });

  test('classifies a non-interaction 404 as permanent not found', () => {
    expect(classifyDiscordError({ status: 404, code: 10008 })).toEqual(
      expect.objectContaining({
        category: 'not_found',
        retryable: false,
        status: 404,
        code: 10008,
      }),
    );
  });

  test.each([
    Object.assign(new Error('aborted'), { name: 'AbortError' }),
    new DiscordOperationTimeoutError(1_500),
    Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
  ])('classifies abort and timeout sentinels as timeout', (error) => {
    expect(classifyDiscordError(error)).toEqual(
      expect.objectContaining({
        category: 'timeout',
        retryable: true,
      }),
    );
  });

  test.each(['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_HEADERS_TIMEOUT'])(
    'classifies network code %s as transient',
    (code) => {
      expect(classifyDiscordError(Object.assign(new Error('network failure'), { code }))).toEqual(
        expect.objectContaining({
          category: 'transient_network',
          retryable: true,
          code,
        }),
      );
    },
  );

  test('reads safe classification fields from nested causes', () => {
    const error = Object.assign(new Error('request failed'), {
      cause: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }),
    });

    expect(classifyDiscordError(error)).toEqual(
      expect.objectContaining({
        category: 'transient_network',
        retryable: true,
        code: 'ECONNRESET',
      }),
    );
  });

  test('classifies unknown errors without exposing the raw message', () => {
    const result = classifyDiscordError(
      new Error('Bot sample-secret-token at https://discord.com/api/v10/webhooks/id/token'),
    );

    expect(result).toEqual({
      category: 'unknown',
      retryable: false,
      safeMessage: 'Unknown Discord operation failure.',
    });
    expect(result.safeMessage).not.toContain('sample-secret-token');
    expect(result.safeMessage).not.toContain('https://');
  });
});
