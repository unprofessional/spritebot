import type { BaseInteraction } from 'discord.js';

import { DRAINING_REPLY, isDrainInProgressError, trackOperation } from '../runtime/lifecycle';
import { DiscordOperationTimeoutError } from './errors';
import { interactionMetadataString, logDiscordFailure } from './logging';
import {
  DiscordInteractionResponder,
  InteractionResponseStateError,
  type InteractionMode,
} from './interaction_responder';

export const DEFAULT_INTERACTION_ACKNOWLEDGEMENT_BUDGET_MS = 1_750;
export const INTERACTION_ACKNOWLEDGEMENT_SAFETY_CEILING_MS = 2_500;

export interface InteractionDispatchPolicy {
  mode: InteractionMode;
  acknowledgement: 'auto-defer' | 'manual';
}

export interface InteractionDispatchOptions<I extends BaseInteraction = BaseInteraction> {
  interaction: I;
  policy: InteractionDispatchPolicy;
  guard?: (interaction: I) => Promise<true | string>;
  handler: (interaction: I) => Promise<unknown>;
  acknowledgementBudgetMs?: number;
}

export class InteractionAcknowledgementDeadlineError extends DiscordOperationTimeoutError {
  readonly budgetMs: number;

  constructor(budgetMs: number) {
    super(budgetMs);
    this.name = 'InteractionAcknowledgementDeadlineError';
    this.message = `Discord interaction was not acknowledged within ${budgetMs}ms.`;
    this.budgetMs = budgetMs;
  }
}

export async function dispatchInteractionWithDeadline<I extends BaseInteraction>(
  options: InteractionDispatchOptions<I>,
): Promise<void> {
  const budgetMs = options.acknowledgementBudgetMs ?? DEFAULT_INTERACTION_ACKNOWLEDGEMENT_BUDGET_MS;
  if (
    !Number.isSafeInteger(budgetMs) ||
    budgetMs <= 0 ||
    budgetMs >= INTERACTION_ACKNOWLEDGEMENT_SAFETY_CEILING_MS
  ) {
    throw new TypeError('Interaction acknowledgement budget must be between 1ms and 2499ms.');
  }

  const responder = new DiscordInteractionResponder(options.interaction, options.policy.mode);
  const routedInteraction = createResponderInteraction(options.interaction, responder);
  let rejectDeadline!: (reason: InteractionAcknowledgementDeadlineError | unknown) => void;
  const deadlineFailure = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });

  const deadline = setTimeout(() => {
    if (responder.acknowledged || responder.state === 'expired') return;

    if (options.policy.acknowledgement === 'auto-defer' && options.policy.mode.kind !== 'modal') {
      void responder.acknowledge().catch(rejectDeadline);
      return;
    }

    responder.expire();
    rejectDeadline(new InteractionAcknowledgementDeadlineError(budgetMs));
  }, budgetMs);

  const work = Promise.resolve().then(async () => {
    const guardResult = options.guard ? await options.guard(routedInteraction) : true;
    if (guardResult !== true) {
      await responder.respond({ content: guardResult });
      return;
    }

    await options.handler(routedInteraction);
    if (
      !responder.acknowledged &&
      responder.state !== 'expired' &&
      options.policy.acknowledgement === 'auto-defer'
    ) {
      await responder.acknowledge();
    }
  });

  try {
    await Promise.race([work, deadlineFailure]);
  } finally {
    clearTimeout(deadline);
  }
}

export async function startTrackedInteractionDispatch<I extends BaseInteraction>(
  options: InteractionDispatchOptions<I>,
): Promise<void> {
  try {
    await trackOperation(`interaction:${options.interaction.type}`, () =>
      dispatchInteractionWithDeadline(options),
    );
  } catch (error) {
    if (isDrainInProgressError(error)) {
      await respondBestEffort(
        options.interaction,
        { content: DRAINING_REPLY, ephemeral: true },
        'drain-fallback',
      );
      return;
    }

    logDiscordFailure(
      {
        operation: 'interaction.dispatch',
        error,
        attempt: 1,
        elapsedMs: 0,
        commandName: interactionMetadataString(options.interaction, 'commandName'),
        customId: interactionMetadataString(options.interaction, 'customId'),
      },
      console.error,
    );
    if (error instanceof InteractionAcknowledgementDeadlineError) return;

    await respondBestEffort(
      options.interaction,
      { content: 'There was an error while executing this action.', ephemeral: true },
      'error-fallback',
    );
  }
}

export async function respondBestEffort(
  interaction: BaseInteraction,
  payload: Record<string, unknown>,
  context: string,
): Promise<void> {
  if (!interaction.isRepliable()) return;

  const responder = new DiscordInteractionResponder(interaction, {
    kind: 'reply',
    visibility: payload.ephemeral === true ? 'ephemeral' : 'public',
  });
  try {
    await responder.respond(payload);
  } catch (error) {
    logDiscordFailure({
      operation: `interaction.${context}`,
      error,
      attempt: 1,
      elapsedMs: 0,
      commandName: interactionMetadataString(interaction, 'commandName'),
      customId: interactionMetadataString(interaction, 'customId'),
    });
  }
}

function createResponderInteraction<I extends BaseInteraction>(
  interaction: I,
  responder: DiscordInteractionResponder,
): I {
  return new Proxy(interaction, {
    get(target, property) {
      if (property === 'replied') {
        return responder.state === 'replied' || responder.state === 'updated';
      }
      if (property === 'deferred') {
        return responder.state === 'deferred_reply' || responder.state === 'deferred_update';
      }
      if (property === 'reply' || property === 'editReply' || property === 'update') {
        return (payload: unknown) => responder.respond(normalizePayload(payload));
      }
      if (property === 'followUp') {
        return (payload: unknown) => responder.followUp(normalizePayload(payload));
      }
      if (property === 'deferReply' || property === 'deferUpdate') {
        return () => responder.acknowledge();
      }
      if (property === 'showModal') {
        return (modal: unknown) => responder.showModal(modal);
      }

      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function normalizePayload(payload: unknown): Record<string, unknown> {
  if (typeof payload === 'string') return { content: payload };
  if (payload && typeof payload === 'object') return payload as Record<string, unknown>;
  throw new InteractionResponseStateError('Interaction responses require a payload object.');
}
