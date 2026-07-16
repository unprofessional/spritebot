import type { BaseInteraction } from 'discord.js';

import { classifyDiscordError } from './errors';
import {
  interactionKind,
  interactionMetadataString,
  logDiscordOperationTelemetry,
} from './logging';

export type InteractionMode =
  | { kind: 'reply'; visibility: 'ephemeral' | 'public' }
  | { kind: 'component-update' }
  | { kind: 'modal' }
  | { kind: 'modal-or-reply'; visibility: 'ephemeral' | 'public' }
  | { kind: 'modal-or-component-update' };

export type ModalPresentationOutcome = 'shown' | 'requires_activation' | 'expired';

export type InteractionResponseState =
  | 'unacknowledged'
  | 'deferred_reply'
  | 'deferred_update'
  | 'replied'
  | 'updated'
  | 'modal_shown'
  | 'expired';

type InteractionPayload = Record<string, unknown>;
export type PreparedComponentUpdateTarget = (payload: InteractionPayload) => Promise<unknown>;

type InteractionCallbacks = {
  replied: boolean;
  deferred: boolean;
  reply(payload: unknown): Promise<unknown>;
  deferReply(payload: unknown): Promise<unknown>;
  editReply(payload: unknown): Promise<unknown>;
  followUp(payload: unknown): Promise<unknown>;
  update(payload: unknown): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
  showModal(modal: unknown): Promise<unknown>;
};

export class InteractionResponseStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InteractionResponseStateError';
  }
}

export class InteractionCallbackError extends Error {
  constructor(
    readonly operation: string,
    options: { cause: unknown },
  ) {
    super(`Discord interaction callback ${operation} had an indeterminate outcome.`, options);
    this.name = 'InteractionCallbackError';
  }
}

export class DiscordInteractionResponder {
  private readonly callbacks: InteractionCallbacks;
  private currentState: InteractionResponseState = 'unacknowledged';
  private serialized: Promise<void> = Promise.resolve();
  private terminalFailureLogged = false;
  private readonly createdAt = Date.now();
  private acknowledgementMethod?: string;
  private acknowledgementMs?: number;

  constructor(
    private readonly interaction: BaseInteraction,
    readonly mode: InteractionMode,
    private readonly preparedComponentUpdateTarget?: PreparedComponentUpdateTarget,
  ) {
    this.callbacks = interaction as unknown as InteractionCallbacks;
    if (this.callbacks.replied) this.currentState = 'replied';
    else if (this.callbacks.deferred) {
      this.currentState = isComponentUpdateMode(mode) ? 'deferred_update' : 'deferred_reply';
    }
  }

  get state(): InteractionResponseState {
    return this.currentState;
  }

  get acknowledged(): boolean {
    return this.currentState !== 'unacknowledged' && this.currentState !== 'expired';
  }

  expire(): void {
    this.currentState = 'expired';
  }

  preparedOriginalMessageUpdateTarget(): PreparedComponentUpdateTarget | undefined {
    if (!isComponentUpdateMode(this.mode)) return undefined;
    return (payload) => this.callbacks.editReply(withoutEphemeral(payload));
  }

  acknowledge(): Promise<void> {
    return this.runSerialized(async () => {
      if (this.currentState === 'expired' || this.currentState !== 'unacknowledged') return;

      if (this.mode.kind === 'modal') {
        throw new InteractionResponseStateError(
          'Modal interactions must acknowledge by calling showModal().',
        );
      }

      if (isComponentUpdateMode(this.mode)) {
        await this.invoke('deferUpdate', () => this.callbacks.deferUpdate(), 'deferred_update');
        return;
      }

      const ephemeral =
        (this.mode.kind === 'reply' || this.mode.kind === 'modal-or-reply') &&
        this.mode.visibility === 'ephemeral';
      await this.invoke(
        'deferReply',
        () => this.callbacks.deferReply({ ephemeral }),
        'deferred_reply',
      );
    });
  }

  respond(payload: InteractionPayload): Promise<void> {
    return this.runSerialized(async () => {
      if (this.currentState === 'expired') return;
      assertNoEphemeralFlag(payload);

      if (this.mode.kind === 'modal') {
        throw new InteractionResponseStateError(
          'Modal interactions must respond with showModal().',
        );
      }

      if (isComponentUpdateMode(this.mode)) {
        await this.respondToComponent(payload, this.mode.kind === 'modal-or-component-update');
        return;
      }

      const replyPayload = this.replyPayload(payload);
      if (this.currentState === 'unacknowledged') {
        await this.invoke('reply', () => this.callbacks.reply(replyPayload), 'replied');
        return;
      }
      if (this.currentState === 'deferred_reply') {
        await this.invoke(
          'editReply',
          () => this.callbacks.editReply(withoutEphemeral(payload)),
          'replied',
        );
        return;
      }
      if (this.currentState === 'replied') {
        await this.invoke('followUp', () => this.callbacks.followUp(replyPayload), 'replied');
        return;
      }

      throw new InteractionResponseStateError(
        `Cannot send a reply-mode response from state ${this.currentState}.`,
      );
    });
  }

  followUp(payload: InteractionPayload): Promise<void> {
    return this.runSerialized(async () => {
      if (this.currentState === 'expired') return;
      assertNoEphemeralFlag(payload);
      if (this.currentState === 'unacknowledged') {
        throw new InteractionResponseStateError(
          'Cannot follow up before acknowledging an interaction.',
        );
      }

      const followUpPayload = this.mode.kind === 'reply' ? this.replyPayload(payload) : payload;
      await this.invoke(
        'followUp',
        () => this.callbacks.followUp(followUpPayload),
        this.currentState,
      );
    });
  }

  showModal(modal: unknown): Promise<void> {
    return this.runSerialized(async () => {
      if (this.currentState === 'expired') return;
      if (
        this.mode.kind !== 'modal' &&
        this.mode.kind !== 'modal-or-reply' &&
        this.mode.kind !== 'modal-or-component-update'
      ) {
        throw new InteractionResponseStateError(
          'showModal() requires modal or modal hybrid interaction mode.',
        );
      }
      if (this.currentState !== 'unacknowledged') {
        throw new InteractionResponseStateError(
          `Cannot show a modal from state ${this.currentState}.`,
        );
      }

      await this.invoke('showModal', () => this.callbacks.showModal(modal), 'modal_shown');
    });
  }

  presentModal(modal: unknown): Promise<ModalPresentationOutcome> {
    return this.runSerialized(async () => {
      if (this.currentState === 'expired') return 'expired';
      if (this.mode.kind !== 'modal-or-reply' && this.mode.kind !== 'modal-or-component-update') {
        throw new InteractionResponseStateError(
          'presentModal() requires a modal hybrid interaction mode.',
        );
      }
      if (
        this.currentState === 'deferred_reply' ||
        this.currentState === 'deferred_update' ||
        this.currentState === 'replied' ||
        this.currentState === 'updated'
      ) {
        return 'requires_activation';
      }
      if (this.currentState !== 'unacknowledged') {
        throw new InteractionResponseStateError(
          `Cannot present a modal from state ${this.currentState}.`,
        );
      }

      await this.invoke('showModal', () => this.callbacks.showModal(modal), 'modal_shown');
      return this.state === 'expired' ? 'expired' : 'shown';
    });
  }

  private async respondToComponent(
    payload: InteractionPayload,
    allowInitialEphemeralReply: boolean,
  ): Promise<void> {
    // When a component-update handler needs to send an ephemeral error instead
    // of updating the original message, route through followUp so the original
    // message stays intact and the user gets a private error.
    const wantsEphemeral = 'ephemeral' in payload && payload.ephemeral === true;

    if (this.currentState === 'unacknowledged') {
      if (this.preparedComponentUpdateTarget && !wantsEphemeral) {
        const acknowledged = await this.invoke(
          'deferUpdate',
          () => this.callbacks.deferUpdate(),
          'deferred_update',
        );
        if (!acknowledged) return;
        await this.respondToPreparedTarget(payload);
        return;
      }
      if (wantsEphemeral) {
        if (allowInitialEphemeralReply) {
          await this.invoke('reply', () => this.callbacks.reply(payload), 'replied');
          return;
        }
        // Can't send an ephemeral update — acknowledge first, then follow up.
        await this.invoke('deferUpdate', () => this.callbacks.deferUpdate(), 'deferred_update');
        await this.invoke('followUp', () => this.callbacks.followUp(payload), 'updated');
        return;
      }
      await this.invoke(
        'update',
        () => this.callbacks.update(withoutEphemeral(payload)),
        'updated',
      );
      return;
    }
    if (this.currentState === 'deferred_update') {
      if (wantsEphemeral) {
        // Already deferred — follow up with an ephemeral message, leaving
        // the original message unchanged.
        await this.invoke('followUp', () => this.callbacks.followUp(payload), 'updated');
        return;
      }
      if (this.preparedComponentUpdateTarget) {
        await this.respondToPreparedTarget(payload);
        return;
      }
      await this.invoke(
        'editReply',
        () => this.callbacks.editReply(withoutEphemeral(payload)),
        'updated',
      );
      return;
    }
    if (this.currentState === 'updated') {
      await this.invoke(
        'followUp',
        () => this.callbacks.followUp(wantsEphemeral ? payload : withoutEphemeral(payload)),
        'updated',
      );
      return;
    }

    throw new InteractionResponseStateError(
      `Cannot send a component update from state ${this.currentState}.`,
    );
  }

  private async respondToPreparedTarget(payload: InteractionPayload): Promise<void> {
    const updatedOriginal = await this.invoke(
      'preparedOriginal.editReply',
      () => this.preparedComponentUpdateTarget!(withoutEphemeral(payload)),
      'deferred_update',
    );
    if (!updatedOriginal) return;
    await this.invoke(
      'editReply',
      () => this.callbacks.editReply(preparedCompletionPayload(payload)),
      'updated',
    );
  }

  private replyPayload(payload: InteractionPayload): InteractionPayload {
    const ephemeral =
      (this.mode.kind === 'reply' || this.mode.kind === 'modal-or-reply') &&
      this.mode.visibility === 'ephemeral';
    if ('ephemeral' in payload && payload.ephemeral !== ephemeral) {
      throw new InteractionResponseStateError(
        'Interaction response visibility cannot change after the response mode is selected.',
      );
    }
    return { ...payload, ephemeral };
  }

  private async invoke(
    operation: string,
    callback: () => Promise<unknown>,
    successState: InteractionResponseState,
  ): Promise<boolean> {
    const startedAt = Date.now();
    const acknowledging = this.currentState === 'unacknowledged';
    try {
      await callback();
      if (this.currentState !== 'expired') this.currentState = successState;
      if (acknowledging && this.acknowledgementMethod === undefined) {
        this.acknowledgementMethod = operation;
        this.acknowledgementMs = Date.now() - this.createdAt;
      }
      this.logTelemetry(operation, 'success', Date.now() - startedAt);
      return true;
    } catch (error) {
      const classified = classifyDiscordError(error);
      if (acknowledging && this.acknowledgementMethod === undefined) {
        this.acknowledgementMethod = operation;
        this.acknowledgementMs = Date.now() - this.createdAt;
      }
      this.logTelemetry(operation, 'failure', Date.now() - startedAt, error);
      if (classified.category === 'interaction_expired') {
        this.currentState = 'expired';
        return false;
      }
      if (classified.category === 'interaction_already_acknowledged') {
        this.reconcileAcknowledgementState(successState);
        return true;
      }

      // Callback failures are indeterminate: Discord may have accepted the request even when the
      // client observed a timeout or reset. Make the responder terminal so surrounding business
      // catches cannot blindly attempt the same callback again.
      this.currentState = 'expired';
      throw new InteractionCallbackError(operation, { cause: error });
    }
  }

  private reconcileAcknowledgementState(fallbackState: InteractionResponseState): void {
    if (this.callbacks.replied) {
      this.currentState = 'replied';
      return;
    }
    if (this.callbacks.deferred) {
      this.currentState = isComponentUpdateMode(this.mode) ? 'deferred_update' : 'deferred_reply';
      return;
    }

    this.currentState = fallbackState;
  }

  private logTelemetry(
    operation: string,
    outcome: 'success' | 'failure',
    elapsedMs: number,
    error?: unknown,
  ): void {
    if (outcome === 'failure' && this.terminalFailureLogged) return;
    if (outcome === 'failure') this.terminalFailureLogged = true;
    logDiscordOperationTelemetry({
      phase: 'final',
      outcome,
      operation: `interaction.${operation}`,
      attempt: 1,
      elapsedMs,
      classified: error === undefined ? undefined : classifyDiscordError(error),
      commandName: interactionMetadataString(this.interaction, 'commandName'),
      customId: interactionMetadataString(this.interaction, 'customId'),
      interactionKind: interactionKind(this.interaction),
      acknowledgementMethod: this.acknowledgementMethod,
      acknowledgementMs: this.acknowledgementMs,
    });
  }

  private runSerialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serialized.then(work);
    this.serialized = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function withoutEphemeral(payload: InteractionPayload): InteractionPayload {
  const result = { ...payload };
  delete result.ephemeral;
  return result;
}

function assertNoEphemeralFlag(payload: InteractionPayload): void {
  const flags = payload.flags;
  if (typeof flags === 'number' && (flags & 64) === 64) {
    throw new InteractionResponseStateError(
      'Use the ephemeral response property instead of MessageFlags.Ephemeral.',
    );
  }
}

function preparedCompletionPayload(payload: InteractionPayload): InteractionPayload {
  return {
    content:
      typeof payload.content === 'string' && payload.content.length > 0
        ? `${payload.content}\n\nThe original message has been refreshed.`
        : '✅ Saved. The original message has been refreshed.',
    components: [],
    embeds: [],
  };
}

function isComponentUpdateMode(mode: InteractionMode): boolean {
  return mode.kind === 'component-update' || mode.kind === 'modal-or-component-update';
}
