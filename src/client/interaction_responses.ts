import type { BaseInteraction, InteractionReplyOptions } from 'discord.js';

type DiscordErrorMetadata = {
  code?: unknown;
  status?: unknown;
};

function metadataValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : 'unknown';
}

export async function bestEffortInteractionResponse(
  interaction: BaseInteraction,
  payload: InteractionReplyOptions,
  context: string,
): Promise<void> {
  if (!interaction.isRepliable()) return;

  const operation = interaction.replied || interaction.deferred ? 'followUp' : 'reply';

  try {
    if (operation === 'followUp') {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (error) {
    const metadata =
      error && typeof error === 'object' ? (error as DiscordErrorMetadata) : undefined;
    console.warn(
      `[interaction-response] fallback failed context=${context} operation=${operation} ` +
        `type=${interaction.type} code=${metadataValue(metadata?.code)} ` +
        `status=${metadataValue(metadata?.status)}`,
    );
  }
}
