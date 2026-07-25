const DISCORD_CUSTOM_ID_MAX_LENGTH = 100;

/**
 * Validates a Discord component or modal custom ID before it reaches discord.js.
 */
export function discordCustomId(value: string): string {
  if (!value.length || value.length > DISCORD_CUSTOM_ID_MAX_LENGTH) {
    throw new RangeError(
      `Discord custom ID must be between 1 and ${DISCORD_CUSTOM_ID_MAX_LENGTH} characters; received ${value.length}.`,
    );
  }
  return value;
}

export { DISCORD_CUSTOM_ID_MAX_LENGTH };
