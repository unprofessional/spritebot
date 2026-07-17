import {
  formatDiscordFailureLog,
  formatDiscordInteractionLifecycleLog,
  formatDiscordModalFlowLog,
  formatDiscordOperationTelemetryLog,
  interactionTelemetryKey,
  logDiscordFailure,
  registerModalFlowTelemetry,
  resolveModalFlowTelemetry,
} from '../../../src/discord/logging';

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

  test('emits safe interaction acknowledgement telemetry', () => {
    const line = formatDiscordOperationTelemetryLog({
      phase: 'final',
      outcome: 'success',
      operation: 'interaction.deferReply',
      attempt: 1,
      elapsedMs: 12,
      interactionKind: 'chat-input-command',
      commandName: 'create-character',
      customId: 'inventory-edit:secret-item-id',
      acknowledgementMethod: 'deferReply',
      acknowledgementMs: 1_742,
      callbackStartMs: 1_700,
      interactionKey: 'abc123',
      flowKey: 'def456',
    });

    expect(line).toContain('operation=interaction.deferReply');
    expect(line).toContain('interactionKind=chat-input-command');
    expect(line).toContain('command=create-character');
    expect(line).toContain('customIdPrefix=inventory-edit');
    expect(line).toContain('acknowledgementMethod=deferReply');
    expect(line).toContain('acknowledgementMs=1742');
    expect(line).toContain('callbackStartMs=1700');
    expect(line).toContain('interactionKey=abc123');
    expect(line).toContain('flowKey=def456');
    expect(line).not.toContain('secret-item-id');
  });

  test('formats safe interaction lifecycle timing without raw custom IDs', () => {
    const line = formatDiscordInteractionLifecycleLog({
      phase: 'completed',
      outcome: 'success',
      elapsedMs: 1_148,
      gatewayLagMs: 24,
      guardMs: 31,
      handlerMs: 1_093,
      state: 'modal_shown',
      interactionKind: 'string-select',
      customId: 'editCharacterStatDropdown:character-secret',
      interactionKey: 'abc123',
      flowKey: 'def456',
    });

    expect(line).toContain('phase=completed');
    expect(line).toContain('gatewayLagMs=24');
    expect(line).toContain('guardMs=31');
    expect(line).toContain('handlerMs=1093');
    expect(line).toContain('state=modal_shown');
    expect(line).toContain('customIdPrefix=editCharacterStatDropdown');
    expect(line).not.toContain('character-secret');
  });

  test('creates stable process-local correlation keys without exposing source IDs', () => {
    const interaction = { id: 'raw-interaction-id' };
    const modal = { toJSON: () => ({ custom_id: 'editCharacterField:character-secret' }) };
    const user = { user: { id: 'raw-user-id' } };

    const interactionKey = interactionTelemetryKey(interaction);
    const flowKey = registerModalFlowTelemetry(modal, user);
    const nextFlowKey = registerModalFlowTelemetry(modal, user);

    expect(interactionKey).toMatch(/^[a-f0-9]{12}$/);
    expect(interactionTelemetryKey(interaction)).toBe(interactionKey);
    expect(flowKey).toMatch(/^[a-f0-9]{12}$/);
    expect(nextFlowKey).toMatch(/^[a-f0-9]{12}$/);
    expect(nextFlowKey).not.toBe(flowKey);
    expect(resolveModalFlowTelemetry('editCharacterField:character-secret', user)).toBe(
      nextFlowKey,
    );
    expect(
      resolveModalFlowTelemetry('editCharacterField:character-secret', {
        user: { id: 'different-user' },
      }),
    ).toBeUndefined();
    expect(interactionKey).not.toContain('raw-interaction-id');
    expect(flowKey).not.toContain('character-secret');
  });

  test('formats prepared modal path telemetry', () => {
    expect(
      formatDiscordModalFlowLog({
        event: 'activation',
        elapsedMs: 2_400,
        interactionKey: 'abc123',
        flowKey: 'def456',
      }),
    ).toBe('[discord-modal] event=activation elapsedMs=2400 interactionKey=abc123 flowKey=def456');
  });
});
