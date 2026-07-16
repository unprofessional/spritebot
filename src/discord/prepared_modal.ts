import { randomUUID } from 'node:crypto';

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ButtonInteraction } from 'discord.js';

import type { InteractionDispatchPolicy } from './interaction_dispatch';
import {
  DiscordInteractionResponder,
  InteractionResponseStateError,
} from './interaction_responder';

const PREPARED_MODAL_PREFIX = 'preparedModal:';
const PREPARED_MODAL_TTL_MS = 10 * 60 * 1_000;
const PREPARED_MODAL_LIMIT = 500;

type PreparedModalEntry = {
  expiresAt: number;
  modal: unknown;
  userId: string;
};

// Prepared values intentionally stay process-local so modal content never enters a custom ID or
// durable table. A restart invalidates the short-lived button with explicit retry guidance, while
// every eventual modal submission still performs authoritative validation.
const preparedModals = new Map<string, PreparedModalEntry>();

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
  if (responder.mode.kind !== 'modal-or-reply') {
    throw new InteractionResponseStateError(
      'Prepared modals require modal-or-reply interaction mode.',
    );
  }

  const outcome = await responder.presentModal(modal);
  if (outcome !== 'requires_activation') return;

  const token = storePreparedModal({ modal, userId });
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
    await responder.respond({
      content: '⚠️ This prepared editor expired. Please start the edit again.',
      ephemeral: true,
    });
    return;
  }

  await responder.showModal(entry.modal);
}

export function isPreparedModalCustomId(customId: string): boolean {
  return customId.startsWith(PREPARED_MODAL_PREFIX);
}

function storePreparedModal({ modal, userId }: { modal: unknown; userId: string }): string {
  prunePreparedModals();
  while (preparedModals.size >= PREPARED_MODAL_LIMIT) {
    const oldestToken = preparedModals.keys().next().value as string | undefined;
    if (!oldestToken) break;
    preparedModals.delete(oldestToken);
  }

  const token = randomUUID();
  preparedModals.set(token, {
    expiresAt: Date.now() + PREPARED_MODAL_TTL_MS,
    modal,
    userId,
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
