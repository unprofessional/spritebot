import {
  entitlementReadPolicy,
  fetchGuildEntitlementsLazy,
} from '../../../src/services/discord_entitlements_api';

const request = {
  applicationId: 'application-1',
  botToken: 'secret-token',
  guildId: 'guild-1',
};

describe('Discord entitlement API boundary', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('uses the bounded safe-read policy and returns a confirmed entitlement list', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response(200, [
        {
          id: 'entitlement-1',
          sku_id: 'sku-1',
          guild_id: 'guild-1',
          application_id: 'application-1',
        },
      ]),
    );

    await expect(fetchGuildEntitlementsLazy(request, dependencies(fetchMock))).resolves.toEqual({
      ok: true,
      entitlements: [
        expect.objectContaining({
          id: 'entitlement-1',
          sku_id: 'sku-1',
          guild_id: 'guild-1',
        }),
      ],
    });

    expect(entitlementReadPolicy).toEqual({
      operation: 'entitlements.fetch-guild',
      timeoutMs: 800,
      totalBudgetMs: 2_000,
      retry: 'safe-read',
      maxAttempts: 2,
    });
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  test('retries a transient network failure within the total budget', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce(response(200, []));
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      fetchGuildEntitlementsLazy(request, dependencies(fetchMock, { sleep })),
    ).resolves.toEqual({ ok: true, entitlements: [] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  test('retries a transient Discord server failure within the total budget', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response(503, { message: 'unavailable' }))
      .mockResolvedValueOnce(response(200, []));
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      fetchGuildEntitlementsLazy(request, dependencies(fetchMock, { sleep })),
    ).resolves.toEqual({ ok: true, entitlements: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('returns a typed timeout instead of a false empty entitlement set', async () => {
    jest.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchMock = jest.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Promise<Response>(() => undefined);
    });

    const result = fetchGuildEntitlementsLazy(request, dependencies(fetchMock));
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(result).resolves.toEqual({
      ok: false,
      failure: expect.objectContaining({ category: 'timeout', retryable: true }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  test.each([401, 403])('does not retry permanent HTTP %s failures', async (status) => {
    const fetchMock = jest.fn().mockResolvedValue(response(status, { message: 'denied' }));

    await expect(fetchGuildEntitlementsLazy(request, dependencies(fetchMock))).resolves.toEqual({
      ok: false,
      failure: expect.objectContaining({
        category: 'authentication_or_permission',
        status,
        retryable: false,
      }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('does not start a rate-limit retry that cannot fit in the total budget', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(response(429, { message: 'slow down' }, { 'retry-after': '2' }));

    await expect(fetchGuildEntitlementsLazy(request, dependencies(fetchMock))).resolves.toEqual({
      ok: false,
      failure: expect.objectContaining({
        category: 'rate_limited',
        retryAfterMs: 2_000,
      }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('honors a short rate-limit retry inside the total budget', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response(429, {}, { 'retry-after': '0.05' }))
      .mockResolvedValueOnce(response(200, []));
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      fetchGuildEntitlementsLazy(request, dependencies(fetchMock, { sleep })),
    ).resolves.toEqual({ ok: true, entitlements: [] });
    expect(sleep).toHaveBeenCalledWith(50);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('treats malformed success payloads as unavailable rather than confirmed empty', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(200, { entitlements: [] }));

    await expect(fetchGuildEntitlementsLazy(request, dependencies(fetchMock))).resolves.toEqual({
      ok: false,
      failure: expect.objectContaining({ category: 'unknown', retryable: false }),
    });
  });
});

function dependencies(fetchMock: jest.Mock, operation: { sleep?: jest.Mock } = {}) {
  return {
    fetch: fetchMock as typeof fetch,
    operation: {
      random: () => 0,
      onEvent: () => undefined,
      ...operation,
    },
  };
}

function response(status: number, body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
