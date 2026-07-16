import type { BaseInteraction } from 'discord.js';

import { classifyDiscordError } from './errors';
import { interactionMetadataString, logDiscordFailure } from './logging';

export type InteractionMode =
  | { kind: 'reply'; visibility: 'ephemeral' | 'public' }
  | { kind: 'component-update' }
  | { kind: 'modal' }
  | { kind: 'modal-or-reply'; visibility: 'ephemeral' | 'public' };

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

export class DiscordInteractionResponder {
  private readonly callbacks: InteractionCallbacks;
  private currentState: InteractionResponseState = 'unacknowledged';
  private serialized: Promise<void> = Promise.resolve();
  private terminalFailureLogged = false;

  constructor(
    private readonly interaction: BaseInteraction,
    readonly mode: InteractionMode,
  ) {
    this.callbacks = interaction as unknown as InteractionCallbacks;
    if (this.callbacks.replied) this.currentState = 'replied';
    else if (this.callbacks.deferred) {
      this.currentState = mode.kind === 'component-update' ? 'deferred_update' : 'deferred_reply';
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

  acknowledge(): Promise<void> {
    return this.runSerialized(async () => {
      if (this.currentState === 'expired' || this.currentState !== 'unacknowledged') return;

      if (this.mode.kind === 'modal') {
        throw new InteractionResponseStateError(
          'Modal interactions must acknowledge by calling showModal().',
        );
      }

      if (this.mode.kind === 'component-update') {
        await this.invoke('deferUpdate', () => this.callbacks.deferUpdate(), 'deferred_update');
        return;
      }

      const ephemeral = this.mode.visibility === 'ephemeral';
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

      if (this.mode.kind === 'modal') {
        throw new InteractionResponseStateError(
          'Modal interactions must respond with showModal().',
        );
      }

      if (this.mode.kind === 'component-update') {
        await this.respondToComponent(payload);
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
      if (this.mode.kind !== 'modal' && this.mode.kind !== 'modal-or-reply') {
        throw new InteractionResponseStateError(
          'showModal() requires modal or modal-or-reply interaction mode.',
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
      if (this.mode.kind !== 'modal-or-reply') {
        throw new InteractionResponseStateError(
          'presentModal() requires modal-or-reply interaction mode.',
        );
      }
      if (this.currentState === 'deferred_reply' || this.currentState === 'replied') {
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

  private async respondToComponent(payload: InteractionPayload): Promise<void> {
    // When a component-update handler needs to send an ephemeral error instead
    // of updating the original message, route through followUp so the original
    // message stays intact and the user gets a private error.
    const wantsEphemeral = 'ephemeral' in payload && payload.ephemeral === true;

    if (this.currentState === 'unacknowledged') {
      if (wantsEphemeral) {
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
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      await callback();
      if (this.currentState !== 'expired') this.currentState = successState;
    } catch (error) {
      const classified = classifyDiscordError(error);
      if (
        classified.category !== 'interaction_expired' &&
        classified.category !== 'interaction_already_acknowledged'
      ) {
        throw error;
      }

      this.logTerminalFailure(operation, error, Date.now() - startedAt);
      if (classified.category === 'interaction_expired') {
        this.currentState = 'expired';
        return;
      }

      this.reconcileAcknowledgementState(successState);
    }
  }

  private reconcileAcknowledgementState(fallbackState: InteractionResponseState): void {
    if (this.callbacks.replied) {
      this.currentState = 'replied';
      return;
    }
    if (this.callbacks.deferred) {
      this.currentState =
        this.mode.kind === 'component-update' ? 'deferred_update' : 'deferred_reply';
      return;
    }

    this.currentState = fallbackState;
  }

  private logTerminalFailure(operation: string, error: unknown, elapsedMs: number): void {
    if (this.terminalFailureLogged) return;
    this.terminalFailureLogged = true;
    logDiscordFailure({
      operation: `interaction.${operation}`,
      error,
      attempt: 1,
      elapsedMs,
      commandName: interactionMetadataString(this.interaction, 'commandName'),
      customId: interactionMetadataString(this.interaction, 'customId'),
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
