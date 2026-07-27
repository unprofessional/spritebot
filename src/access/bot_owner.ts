export function isBotOwner(userId: string): boolean {
  const ownerId = (process.env.OWNER_DISCORD_ID ?? '').trim();
  return Boolean(ownerId) && userId === ownerId;
}
