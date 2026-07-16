import {
  DEFAULT_INTERACTION_ACKNOWLEDGEMENT_BUDGET_MS,
  InteractionAcknowledgementDeadlineError,
  dispatchInteractionWithDeadline,
  respondBestEffort,
  startTrackedInteractionDispatch,
  type InteractionDispatchPolicy,
} from '../../../src/discord/interaction_dispatch';
import { UPGRADE_MSG } from '../../../src/access/guards';
import {
  beginDrain,
  DRAINING_REPLY,
  getInFlightOperations,
  resetLifecycleForTests,
} from '../../../src/runtime/lifecycle';

describe('deadline-aware interaction dispatch', () => {
  let errorSpy: jest.SpiedFunction<typeof console.error>;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    resetLifecycleForTests();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
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

  test('never auto-defers a modal-first handler', async () => {
    jest.useFakeTimers();
    const interaction = componentInteraction();
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
