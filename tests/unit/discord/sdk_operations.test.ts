import { executeDiscordSdkMethod } from '../../../src/discord/sdk_operations';
import { defineDiscordOperationPolicy } from '../../../src/discord/operation_policy';

describe('Discord SDK operation boundary', () => {
  test('preserves the target receiver and method arguments', async () => {
    const target = {
      prefix: 'guild',
      async fetch(this: { prefix: string }, id: string) {
        return `${this.prefix}:${id}`;
      },
    };

    await expect(executeDiscordSdkMethod(policy(), target, 'fetch', '123')).resolves.toBe(
      'guild:123',
    );
  });

  test('applies operation timeout and retry policy to SDK methods', async () => {
    const target = {
      fetch: jest
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
        .mockResolvedValueOnce('ready'),
    };

    await expect(
      executeDiscordSdkMethod(policy({ retry: 'safe-read', maxAttempts: 2 }), target, 'fetch'),
    ).resolves.toBe('ready');
    expect(target.fetch).toHaveBeenCalledTimes(2);
  });
});

function policy(overrides: { retry?: 'safe-read'; maxAttempts?: number } = {}) {
  return defineDiscordOperationPolicy({
    operation: 'test.sdk-method',
    timeoutMs: 1_000,
    totalBudgetMs: 3_000,
    ...overrides,
  });
}
