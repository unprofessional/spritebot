import {
  DEFAULT_INTERACTION_ACKNOWLEDGEMENT_BUDGET_MS,
  InteractionAcknowledgementDeadlineError,
  INTERACTION_ACKNOWLEDGEMENT_SAFETY_CEILING_MS,
  dispatchInteractionWithDeadline,
  respondBestEffort,
  startTrackedInteractionDispatch,
  type InteractionDispatchPolicy,
} from '../../../src/discord/interaction_dispatch';
import { AUTHORIZATION_UNAVAILABLE_MSG, UPGRADE_MSG } from '../../../src/access/guards';
import {
  beginDrain,
  DRAINING_REPLY,
  getInFlightOperations,
  resetLifecycleForTests,
} from '../../../src/runtime/lifecycle';

describe('deadline-aware interaction dispatch', () => {
  let errorSpy: jest.SpiedFunction<typeof console.error>;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;
  let debugSpy: jest.SpiedFunction<typeof console.debug>;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    resetLifecycleForTests();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });

  test('rejects acknowledgement budgets at or above the safety ceiling', async () => {
    const interaction = replyInteraction();

    await expect(
      dispatchInteractionWithDeadline({
        interaction: interaction as never,
        policy: replyPolicy(),
        handler: async () => undefined,
        acknowledgementBudgetMs: INTERACTION_ACKNOWLEDGEMENT_SAFETY_CEILING_MS,
      }),
    ).rejects.toThrow('between 1ms and 2499ms');
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test('defers a slow guarded command before the acknowledgement budget and edits its first response', async () => {
    jest.useFakeTimers();
    const interaction = replyInteraction();
    const guard = deferred<true | string>();
    const handler = jest.fn(async (routed: typeof interaction) => {
      await routed.reply({ content: 'ready', ephemeral: true });
    });

    const result = dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: replyPolicy(),
      guard: () => guard.promise,
      handler: handler as never,
    });
    await jest.advanceTimersByTimeAsync(DEFAULT_INTERACTION_ACKNOWLEDGEMENT_BUDGET_MS);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(handler).not.toHaveBeenCalled();

    guard.resolve(true);
    await result;

    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'ready' });
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test('edits the deferred reply with the existing guard denial', async () => {
    jest.useFakeTimers();
    const interaction = replyInteraction();
    const guard = deferred<true | string>();
    const handler = jest.fn();
    const result = dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: replyPolicy(),
      guard: () => guard.promise,
      handler,
    });
    await jest.advanceTimersByTimeAsync(DEFAULT_INTERACTION_ACKNOWLEDGEMENT_BUDGET_MS);

    guard.resolve(UPGRADE_MSG);
    await result;

    expect(interaction.editReply).toHaveBeenCalledWith({ content: UPGRADE_MSG });
    expect(handler).not.toHaveBeenCalled();
  });

  test('completes a deferred unavailable authorization without an upgrade CTA', async () => {
    jest.useFakeTimers();
    const interaction = replyInteraction();
    const guard = deferred<true | string>();
    const handler = jest.fn();
    const result = dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: replyPolicy(),
      guard: () => guard.promise,
      handler,
    });
    await jest.advanceTimersByTimeAsync(DEFAULT_INTERACTION_ACKNOWLEDGEMENT_BUDGET_MS);

    guard.resolve(AUTHORIZATION_UNAVAILABLE_MSG);
    await result;

    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'I couldn’t verify this server’s access with Discord right now. Nothing was changed. Please try again in a moment.',
    });
    expect(interaction.editReply).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: UPGRADE_MSG }),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  test('lets a fast command reply immediately without an unnecessary deferral', async () => {
    jest.useFakeTimers();
    const interaction = replyInteraction();

    await dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: replyPolicy(),
      guard: async () => true,
      handler: async (routed) => {
        await (routed as typeof interaction).reply({ content: 'fast', ephemeral: true });
      },
    });
    await jest.runAllTimersAsync();

    expect(interaction.reply).toHaveBeenCalledWith({ content: 'fast', ephemeral: true });
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test('logs correlated receipt and completion timing around guard and handler work', async () => {
    const interaction = replyInteraction();
    interaction.id = 'interaction-1';
    interaction.createdTimestamp = Date.now() - 25;

    await dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: replyPolicy(),
      guard: async () => true,
      handler: async (routed) => {
        await (routed as typeof interaction).reply({ content: 'ready', ephemeral: true });
      },
    });

    const lifecycleLines = debugSpy.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.startsWith('[discord-interaction]'));
    expect(lifecycleLines).toHaveLength(2);
    expect(lifecycleLines[0]).toContain('phase=received');
    expect(lifecycleLines[0]).toMatch(/gatewayLagMs=\d+/);
    expect(lifecycleLines[1]).toContain('phase=completed');
    expect(lifecycleLines[1]).toContain('state=replied');
    expect(lifecycleLines[1]).toMatch(/guardMs=\d+/);
    expect(lifecycleLines[1]).toMatch(/handlerMs=\d+/);
    const receivedKey = lifecycleLines[0].match(/interactionKey=([a-f0-9]+)/)?.[1];
    expect(receivedKey).toBeDefined();
    expect(lifecycleLines[1]).toContain(`interactionKey=${receivedKey}`);
    expect(lifecycleLines.join(' ')).not.toContain('interaction-1');
  });

  test('never auto-defers a modal-first handler', async () => {
    jest.useFakeTimers();
    const interaction = componentInteraction();
    interaction.id = 'modal-opener-interaction';
    interaction.user = { id: 'modal-owner' };
    const modal = { customId: 'edit:modal' };

    await dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: { mode: { kind: 'modal' }, acknowledgement: 'manual' },
      handler: async (routed) => {
        await (routed as typeof interaction).showModal(modal);
      },
    });

    expect(interaction.showModal).toHaveBeenCalledWith(modal);
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    const telemetryLines = debugSpy.mock.calls.map(([line]) => String(line));
    const operationFlowKey = telemetryLines
      .find((line) => line.includes('operation=interaction.showModal'))
      ?.match(/flowKey=([a-f0-9]+)/)?.[1];
    expect(operationFlowKey).toBeDefined();
    expect(
      telemetryLines.find(
        (line) => line.startsWith('[discord-interaction]') && line.includes('phase=completed'),
      ),
    ).toContain(`flowKey=${operationFlowKey}`);
  });

  test('fails a late modal handler at the deadline and suppresses its late callback', async () => {
    jest.useFakeTimers();
    const interaction = componentInteraction();
    const work = deferred<void>();
    const result = dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: { mode: { kind: 'modal' }, acknowledgement: 'manual' },
      handler: async (routed) => {
        await work.promise;
        await (routed as typeof interaction).showModal({ customId: 'late:modal' });
      },
    });
    const rejection = expect(result).rejects.toBeInstanceOf(
      InteractionAcknowledgementDeadlineError,
    );

    await jest.advanceTimersByTimeAsync(DEFAULT_INTERACTION_ACKNOWLEDGEMENT_BUDGET_MS);
    await rejection;
    work.resolve();
    await Promise.resolve();

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test('terminally contains a tracked modal deadline without attempting a fallback callback', async () => {
    jest.useFakeTimers();
    const interaction = componentInteraction();
    const work = deferred<void>();
    const result = startTrackedInteractionDispatch({
      interaction: interaction as never,
      policy: { mode: { kind: 'modal' }, acknowledgement: 'manual' },
      handler: async (routed) => {
        await work.promise;
        await (routed as typeof interaction).showModal({ customId: 'late:modal' });
      },
    });

    await jest.advanceTimersByTimeAsync(DEFAULT_INTERACTION_ACKNOWLEDGEMENT_BUDGET_MS);
    await expect(result).resolves.toBeUndefined();
    work.resolve();
    await Promise.resolve();

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test('tracks dispatch work and catches terminal failures with a contained fallback', async () => {
    const interaction = replyInteraction();
    const work = deferred<void>();
    const result = startTrackedInteractionDispatch({
      interaction: interaction as never,
      policy: replyPolicy(),
      handler: async () => {
        await work.promise;
        throw new Error('handler failed with secret-token');
      },
    });

    expect(getInFlightOperations()).toEqual([expect.objectContaining({ name: 'interaction:2' })]);
    work.resolve();
    await expect(result).resolves.toBeUndefined();

    expect(getInFlightOperations()).toEqual([]);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'There was an error while executing this action.',
      ephemeral: true,
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('secret-token');
  });

  test('contains drain rejection and responds without starting tracked work', async () => {
    const interaction = replyInteraction();
    const handler = jest.fn();
    beginDrain('test');

    await expect(
      startTrackedInteractionDispatch({
        interaction: interaction as never,
        policy: replyPolicy(),
        handler,
      }),
    ).resolves.toBeUndefined();

    expect(handler).not.toHaveBeenCalled();
    expect(getInFlightOperations()).toEqual([]);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: DRAINING_REPLY,
      ephemeral: true,
    });
  });

  test.each([
    { replied: true, deferred: false, expected: 'followUp' },
    { replied: false, deferred: true, expected: 'editReply' },
  ])('routes an acknowledged best-effort response through $expected', async (state) => {
    const interaction = replyInteraction();
    interaction.replied = state.replied;
    interaction.deferred = state.deferred;

    await respondBestEffort(
      interaction as never,
      { content: 'contained', ephemeral: true },
      'test-fallback',
    );

    expect(interaction[state.expected as 'followUp' | 'editReply']).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});

function replyPolicy(): InteractionDispatchPolicy {
  return {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  };
}

function replyInteraction() {
  return {
    id: undefined as string | undefined,
    createdTimestamp: undefined as number | undefined,
    user: undefined as { id: string } | undefined,
    type: 2,
    commandName: 'create-character',
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    showModal: jest.fn().mockResolvedValue(undefined),
  };
}

function componentInteraction() {
  return { ...replyInteraction(), type: 3, customId: 'edit:button' };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
