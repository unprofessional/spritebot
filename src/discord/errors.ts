export type DiscordErrorCategory =
  | 'interaction_expired'
  | 'interaction_already_acknowledged'
  | 'rate_limited'
  | 'authentication_or_permission'
  | 'not_found'
  | 'timeout'
  | 'transient_network'
  | 'unknown';

export interface ClassifiedDiscordError {
  category: DiscordErrorCategory;
  retryable: boolean;
  code?: number | string;
  status?: number;
  retryAfterMs?: number;
  safeMessage: string;
}

type ErrorRecord = Record<string, unknown>;

const transientNetworkCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const maxSafeRetryDelayMs = 60_000;

export class DiscordOperationTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Discord operation exceeded its ${timeoutMs}ms timeout.`);
    this.name = 'DiscordOperationTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function classifyDiscordError(error: unknown): ClassifiedDiscordError {
  const records = collectErrorRecords(error);
  const code = firstPrimitive(records, 'code');
  const status = firstNumber(records, ['status', 'statusCode']);

  if (code === 10062 || code === '10062') {
    return classified('interaction_expired', false, 'Discord interaction expired.', code, status);
  }

  if (code === 40060 || code === '40060') {
    return classified(
      'interaction_already_acknowledged',
      false,
      'Discord interaction was already acknowledged.',
      code,
      status,
    );
  }

  if (isTimeout(error, records, code)) {
    return classified('timeout', true, 'Discord operation timed out.', code, status);
  }

  if (typeof code === 'string' && transientNetworkCodes.has(code.toUpperCase())) {
    return classified(
      'transient_network',
      true,
      'Transient Discord network failure.',
      code,
      status,
    );
  }

  if (status === 429) {
    const retryAfterMs = findRetryAfterMs(records);
    return {
      ...classified(
        'rate_limited',
        retryAfterMs !== undefined,
        'Discord rate limit encountered.',
        code,
        status,
      ),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }

  if (status === 401 || status === 403) {
    return classified(
      'authentication_or_permission',
      false,
      'Discord authentication or permission failure.',
      code,
      status,
    );
  }

  if (status !== undefined && status >= 500 && status <= 599) {
    return classified('transient_network', true, 'Transient Discord server failure.', code, status);
  }

  if (status === 404) {
    return classified('not_found', false, 'Discord resource not found.', code, status);
  }

  return classified('unknown', false, 'Unknown Discord operation failure.', code, status);
}

function classified(
  category: DiscordErrorCategory,
  retryable: boolean,
  safeMessage: string,
  code?: number | string,
  status?: number,
): ClassifiedDiscordError {
  return {
    category,
    retryable,
    ...(code === undefined ? {} : { code }),
    ...(status === undefined ? {} : { status }),
    safeMessage,
  };
}

function collectErrorRecords(error: unknown): ErrorRecord[] {
  const records: ErrorRecord[] = [];
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0 && records.length < 8) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    const record = current as ErrorRecord;
    records.push(record);
    queue.push(record.cause, record.rawError, record.response);
  }

  return records;
}

function firstPrimitive(records: ErrorRecord[], key: string): number | string | undefined {
  for (const record of records) {
    const value = record[key];
    if (typeof value === 'number' || typeof value === 'string') return value;
  }
  return undefined;
}

function firstNumber(records: ErrorRecord[], keys: string[]): number | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      const number = typeof value === 'string' ? Number(value) : value;
      if (typeof number === 'number' && Number.isFinite(number)) return number;
    }
  }
  return undefined;
}

function isTimeout(
  error: unknown,
  records: ErrorRecord[],
  code: number | string | undefined,
): boolean {
  if (error instanceof DiscordOperationTimeoutError) return true;
  if (code === 'ETIMEDOUT') return true;
  return records.some(
    (record) => record.name === 'AbortError' || record.name === 'DiscordOperationTimeoutError',
  );
}

function findRetryAfterMs(records: ErrorRecord[]): number | undefined {
  for (const record of records) {
    const millisecondValue = finiteNumber(record.retryAfterMs ?? record.retryAfter);
    if (isSafeRetryDelay(millisecondValue)) return millisecondValue;

    const secondValue = finiteNumber(record.retry_after);
    if (secondValue !== undefined) {
      const converted = Math.round(secondValue * 1_000);
      if (isSafeRetryDelay(converted)) return converted;
    }

    const headers = record.headers;
    if (headers && typeof headers === 'object') {
      const retryAfterHeader = finiteNumber((headers as ErrorRecord)['retry-after']);
      if (retryAfterHeader !== undefined) {
        const converted = Math.round(retryAfterHeader * 1_000);
        if (isSafeRetryDelay(converted)) return converted;
      }
    }
  }
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
}

function isSafeRetryDelay(value: number | undefined): value is number {
  return value !== undefined && value >= 0 && value <= maxSafeRetryDelayMs;
}
