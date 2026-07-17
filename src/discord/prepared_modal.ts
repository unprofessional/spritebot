import { randomUUID } from 'node:crypto';

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';

import type { InteractionDispatchPolicy } from './interaction_dispatch';
import { logDiscordModalFlow } from './logging';
import {
  DiscordInteractionResponder,
  InteractionResponseStateError,
  type PreparedComponentUpdateTarget,
} from './interaction_responder';

const PREPARED_MODAL_PREFIX = 'preparedModal:';
const PREPARED_SUBMISSION_PREFIX = 'preparedSubmit:';
const PREPARED_MODAL_TTL_MS = 10 * 60 * 1_000;
const PREPARED_MODAL_LIMIT = 500;

type PreparedModalEntry = {
  createdAt: number;
  expiresAt: number;
  modal: unknown;
  userId: string;
  updateOriginal?: PreparedComponentUpdateTarget;
};

type PreparedSubmissionEntry = {
  expiresAt: number;
  originalCustomId: string;
  updateOriginal?: PreparedComponentUpdateTarget;
  userId: string;
};

// Prepared values intentionally stay process-local so modal content never enters a custom ID or
// durable table. A restart invalidates the short-lived button with explicit retry guidance, while
// every eventual modal submission still performs authoritative validation.
const preparedModals = new Map<string, PreparedModalEntry>();
const preparedSubmissions = new Map<string, PreparedSubmissionEntry>();

export interface PreparedModalSubmissionResolution {
  interaction: ModalSubmitInteraction;
  updateOriginal?: PreparedComponentUpdateTarget;
}

export const preparedModalInteractionPolicy = {
  mode: { kind: 'modal-or-reply', visibility: 'ephemeral' },
  // Activation must preserve the button interaction's initial response for showModal(). Both the
  // modal and expired-token reply paths are process-local and immediately available.
  acknowledgement: 'manual',
} satisfies InteractionDispatchPolicy;

export async function presentPreparedModal({
  modal,
  responder,
  userId,
}: {
  modal: unknown;
  responder: DiscordInteractionResponder;
  userId: string;
}): Promise<void> {
  if (
    responder.mode.kind !== 'modal-or-reply' &&
    responder.mode.kind !== 'modal-or-component-update'
  ) {
    throw new InteractionResponseStateError(
      'Prepared modals require a modal hybrid interaction mode.',
    );
  }

  const outcome = await responder.presentModal(modal);
  logDiscordModalFlow({
    event:
      outcome === 'shown' ? 'fast' : outcome === 'requires_activation' ? 'prepared' : 'expired',
    elapsedMs: responder.elapsedMs,
    interactionKey: responder.telemetryKey,
    flowKey: responder.modalFlowKey,
  });
  if (outcome !== 'requires_activation') return;

  const token = storePreparedModal({
    modal,
    userId,
    updateOriginal: responder.preparedOriginalMessageUpdateTarget(),
  });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREPARED_MODAL_PREFIX}${token}`)
      .setLabel('Open editor')
      .setStyle(ButtonStyle.Primary),
  );

  await responder.respond({
    content: 'Discord needed a moment. Select **Open editor** to continue where you left off.',
    components: [row],
    ephemeral: true,
  });
}

export async function activatePreparedModal(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const token = interaction.customId.startsWith(PREPARED_MODAL_PREFIX)
    ? interaction.customId.slice(PREPARED_MODAL_PREFIX.length)
    : '';
  const entry = takePreparedModal(token, interaction.user.id);

  if (!entry) {
    logDiscordModalFlow({
      event: 'expired',
      elapsedMs: responder.elapsedMs,
      interactionKey: responder.telemetryKey,
    });
    await responder.respond({
      content: '⚠️ This prepared editor expired. Please start the edit again.',
      ephemeral: true,
    });
    return;
  }

  const originalCustomId = modalCustomId(entry.modal);
  if (entry.updateOriginal && originalCustomId) {
    const submissionToken = storePreparedSubmission({
      originalCustomId,
      updateOriginal: entry.updateOriginal,
      userId: entry.userId,
    });
    setModalCustomId(entry.modal, `${PREPARED_SUBMISSION_PREFIX}${submissionToken}`);
  }

  await responder.showModal(entry.modal);
  logDiscordModalFlow({
    event: 'activation',
    elapsedMs: Date.now() - entry.createdAt,
    interactionKey: responder.telemetryKey,
    flowKey: responder.modalFlowKey,
  });
}

export function isPreparedModalCustomId(customId: string): boolean {
  return customId.startsWith(PREPARED_MODAL_PREFIX);
}

export function resolvePreparedModalSubmission(
  interaction: ModalSubmitInteraction,
): PreparedModalSubmissionResolution {
  if (!interaction.customId.startsWith(PREPARED_SUBMISSION_PREFIX)) return { interaction };

  const token = interaction.customId.slice(PREPARED_SUBMISSION_PREFIX.length);
  const entry = takePreparedSubmission(token, interaction.user.id);
  if (!entry) return { interaction };

  const routedInteraction = new Proxy(interaction, {
    get(target, property) {
      if (property === 'customId') return entry.originalCustomId;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { interaction: routedInteraction, updateOriginal: entry.updateOriginal };
}

function storePreparedModal({
  modal,
  userId,
  updateOriginal,
}: {
  modal: unknown;
  userId: string;
  updateOriginal?: PreparedComponentUpdateTarget;
}): string {
  prunePreparedModals();
  while (preparedModals.size >= PREPARED_MODAL_LIMIT) {
    const oldestToken = preparedModals.keys().next().value as string | undefined;
    if (!oldestToken) break;
    preparedModals.delete(oldestToken);
  }

  const token = randomUUID();
  const createdAt = Date.now();
  preparedModals.set(token, {
    createdAt,
    expiresAt: createdAt + PREPARED_MODAL_TTL_MS,
    modal,
    userId,
    updateOriginal,
  });
  return token;
}

function takePreparedModal(token: string, userId: string): PreparedModalEntry | null {
  prunePreparedModals();
  const entry = preparedModals.get(token);
  if (!entry || entry.userId !== userId) return null;

  preparedModals.delete(token);
  return entry;
}

function prunePreparedModals(): void {
  const now = Date.now();
  for (const [token, entry] of preparedModals) {
    if (entry.expiresAt <= now) preparedModals.delete(token);
  }
}

function storePreparedSubmission({
  originalCustomId,
  updateOriginal,
  userId,
}: Omit<PreparedSubmissionEntry, 'expiresAt'>): string {
  prunePreparedSubmissions();
  while (preparedSubmissions.size >= PREPARED_MODAL_LIMIT) {
    const oldestToken = preparedSubmissions.keys().next().value as string | undefined;
    if (!oldestToken) break;
    preparedSubmissions.delete(oldestToken);
  }

  const token = randomUUID();
  preparedSubmissions.set(token, {
    expiresAt: Date.now() + PREPARED_MODAL_TTL_MS,
    originalCustomId,
    updateOriginal,
    userId,
  });
  return token;
}

function takePreparedSubmission(token: string, userId: string): PreparedSubmissionEntry | null {
  prunePreparedSubmissions();
  const entry = preparedSubmissions.get(token);
  if (!entry || entry.userId !== userId) return null;
  preparedSubmissions.delete(token);
  return entry;
}

function prunePreparedSubmissions(): void {
  const now = Date.now();
  for (const [token, entry] of preparedSubmissions) {
    if (entry.expiresAt <= now) preparedSubmissions.delete(token);
  }
}

function modalCustomId(modal: unknown): string | undefined {
  if (!modal || typeof modal !== 'object') return undefined;
  const toJSON = (modal as { toJSON?: () => { custom_id?: unknown } }).toJSON;
  if (typeof toJSON !== 'function') return undefined;
  const customId = toJSON.call(modal).custom_id;
  return typeof customId === 'string' ? customId : undefined;
}

function setModalCustomId(modal: unknown, customId: string): void {
  const setCustomId = (modal as { setCustomId?: (value: string) => unknown }).setCustomId;
  if (typeof setCustomId !== 'function') {
    throw new InteractionResponseStateError('Prepared modal does not support custom IDs.');
  }
  setCustomId.call(modal, customId);
}
