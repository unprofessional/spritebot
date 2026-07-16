import { formatDiscordFailureLog, logDiscordFailure } from '../../../src/discord/logging';

describe('Discord failure logging', () => {
  test('emits useful classified metadata without logging secrets or request details', () => {
    const error = Object.assign(
      new Error(
        'Unknown interaction at https://discord.com/api/v10/interactions/123/interaction-secret/callback',
      ),
      {
        name: 'DiscordAPIError',
        code: 10062,
        status: 404,
        url: 'https://discord.com/api/v10/interactions/123/interaction-secret/callback',
        headers: { Authorization: 'Bot sample-secret-token' },
        webhookUrl: 'https://discord.com/api/v10/webhooks/456/webhook-secret',
        requestBody: { token: 'request-body-secret', content: 'private content' },
        rawError: { message: 'raw-error-secret', code: 10062 },
      },
    );
    const sink = jest.fn();

    logDiscordFailure(
      {
        operation: 'interaction.callback',
        error,
        attempt: 2,
        elapsedMs: 1_742,
        commandName: 'create-character',
        customId: 'inventory-edit:item-id:user-id',
      },
      sink,
    );

    expect(sink).toHaveBeenCalledTimes(1);
    const line = String(sink.mock.calls[0][0]);
    expect(line).toContain('operation=interaction.callback');
    expect(line).toContain('category=interaction_expired');
    expect(line).toContain('code=10062');
    expect(line).toContain('status=404');
    expect(line).toContain('attempt=2');
    expect(line).toContain('elapsedMs=1742');
    expect(line).toContain('command=create-character');
    expect(line).toContain('customIdPrefix=inventory-edit');
    expect(line).not.toContain('interaction-secret');
    expect(line).not.toContain('sample-secret-token');
    expect(line).not.toContain('webhook-secret');
    expect(line).not.toContain('request-body-secret');
    expect(line).not.toContain('private content');
    expect(line).not.toContain('raw-error-secret');
    expect(line).not.toContain('https://');
    expect(line).not.toContain('/callback');
  });

  test('omits unsafe operation and interaction labels', () => {
    const line = formatDiscordFailureLog({
      operation: 'unsafe operation Authorization: Bot secret',
      error: { status: 403 },
      attempt: 1,
      elapsedMs: 5,
      commandName: 'bad command token',
      customId: 'unsafe token:value',
    });

    expect(line).toContain('operation=unknown');
    expect(line).toContain('category=authentication_or_permission');
    expect(line).not.toContain('Authorization');
    expect(line).not.toContain('secret');
    expect(line).not.toContain('bad command');
    expect(line).not.toContain('unsafe token');
  });

  test('logs a bounded rate-limit delay when it is safe to retry', () => {
    const line = formatDiscordFailureLog({
      operation: 'guild.fetch',
      error: { status: 429, retryAfter: 750 },
      attempt: 1,
      elapsedMs: 10,
    });

    expect(line).toContain('category=rate_limited');
    expect(line).toContain('retryable=true');
    expect(line).toContain('retryAfterMs=750');
  });
});
