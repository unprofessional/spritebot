import {
  dispatchInteractionWithDeadline,
  startTrackedInteractionDispatch,
  type InteractionDispatchPolicy,
} from '../../../src/discord/interaction_dispatch';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import { resetLifecycleForTests } from '../../../src/runtime/lifecycle';

describe('Discord interaction failure contracts', () => {
  let errorSpy: jest.SpiedFunction<typeof console.error>;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    jest.useFakeTimers();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
    resetLifecycleForTests();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test('replies immediately when work completes just before the acknowledgement budget', async () => {
    await expectNoUnhandledRejection(async () => {
      const interaction = replyInteraction();
      const result = dispatchInteractionWithDeadline({
        interaction: interaction as never,
        policy: replyPolicy(),
        acknowledgementBudgetMs: 100,
        handler: async (routed) => {
          await delay(99);
          await (routed as typeof interaction).reply({ content: 'ready', ephemeral: true });
        },
      });
      await Promise.resolve();

      await jest.advanceTimersByTimeAsync(99);
      await result;

      expect(interaction.reply).toHaveBeenCalledWith({ content: 'ready', ephemeral: true });
      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });

  test('defers once and edits when work completes just after the acknowledgement budget', async () => {
    await expectNoUnhandledRejection(async () => {
      const interaction = replyInteraction();
      const result = dispatchInteractionWithDeadline({
        interaction: interaction as never,
        policy: replyPolicy(),
        acknowledgementBudgetMs: 100,
        handler: async (routed) => {
          await delay(101);
          await (routed as typeof interaction).reply({ content: 'ready', ephemeral: true });
        },
      });
      await Promise.resolve();

      await jest.advanceTimersByTimeAsync(100);
      expect(interaction.deferReply).toHaveBeenCalledTimes(1);
      expect(interaction.reply).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      await result;

      expect(interaction.editReply).toHaveBeenCalledWith({ content: 'ready' });
      expect(interaction.reply).not.toHaveBeenCalled();
    });
  });

  test('contains 10062 from the first callback without a second response attempt', async () => {
    await expectNoUnhandledRejection(async () => {
      const interaction = replyInteraction();
      interaction.reply.mockRejectedValue(discordError(10062));

      await expect(
        startTrackedInteractionDispatch({
          interaction: interaction as never,
          policy: replyPolicy(),
          handler: async (routed) => {
            await (routed as typeof interaction).reply({ content: 'late', ephemeral: true });
          },
        }),
      ).resolves.toBeUndefined();

      expect(interaction.reply).toHaveBeenCalledTimes(1);
      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(interaction.editReply).not.toHaveBeenCalled();
      expect(interaction.followUp).not.toHaveBeenCalled();
    });
  });

  test('contains 10062 from the terminal fallback without recursive fallback attempts', async () => {
    await expectNoUnhandledRejection(async () => {
      const interaction = replyInteraction();
      interaction.reply.mockRejectedValue(discordError(10062));

      await expect(
        startTrackedInteractionDispatch({
          interaction: interaction as never,
          policy: replyPolicy(),
          handler: async () => {
            throw new Error('handler failed');
          },
        }),
      ).resolves.toBeUndefined();

      expect(interaction.reply).toHaveBeenCalledTimes(1);
      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(interaction.editReply).not.toHaveBeenCalled();
      expect(interaction.followUp).not.toHaveBeenCalled();
    });
  });

  test('contains an ambiguous callback failure when a business catch attempts an error response', async () => {
    await expectNoUnhandledRejection(async () => {
      const interaction = replyInteraction();
      interaction.reply.mockRejectedValueOnce(
        Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
      );

      await expect(
        startTrackedInteractionDispatch({
          interaction: interaction as never,
          policy: replyPolicy(),
          handler: async (routed) => {
            try {
              await (routed as typeof interaction).reply({ content: 'success', ephemeral: true });
            } catch {
              await (routed as typeof interaction).reply({
                content: 'business error',
                ephemeral: true,
              });
            }
          },
        }),
      ).resolves.toBeUndefined();

      expect(interaction.reply).toHaveBeenCalledTimes(1);
      expect(interaction.editReply).not.toHaveBeenCalled();
      expect(interaction.followUp).not.toHaveBeenCalled();
    });
  });

  test('reconciles concurrent 40060 acknowledgements and performs one callback per state', async () => {
    await expectNoUnhandledRejection(async () => {
      const interaction = replyInteraction();
      interaction.deferReply.mockImplementation(async () => {
        interaction.deferred = true;
        throw discordError(40060);
      });
      const responder = new DiscordInteractionResponder(interaction as never, replyPolicy().mode);

      await Promise.all([responder.acknowledge(), responder.acknowledge()]);
      await responder.respond({ content: 'continued' });

      expect(interaction.deferReply).toHaveBeenCalledTimes(1);
      expect(interaction.editReply).toHaveBeenCalledTimes(1);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: 'continued' });
      expect(interaction.reply).not.toHaveBeenCalled();
      expect(interaction.followUp).not.toHaveBeenCalled();
    });
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
    commandName: 'contract-test',
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

function discordError(code: number): Error & { code: number; status: number } {
  return Object.assign(new Error(`Discord callback failed with ${code}`), { code, status: 400 });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function expectNoUnhandledRejection(work: () => Promise<void>): Promise<void> {
  const listenerCount = process.listenerCount('unhandledRejection');
  const unhandled: unknown[] = [];
  const listener = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', listener);

  try {
    await work();
    await Promise.resolve();
    expect(unhandled).toEqual([]);
  } finally {
    process.off('unhandledRejection', listener);
    expect(process.listenerCount('unhandledRejection')).toBe(listenerCount);
  }
}
