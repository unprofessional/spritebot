export const RP_PROXY_CHUNK_CHARACTER_LIMIT = 2000;
export const RP_PROXY_TOTAL_CHARACTER_LIMIT = 4000;

export function splitRpMessage(
  content: string,
  chunkLimit = RP_PROXY_CHUNK_CHARACTER_LIMIT,
): string[] {
  const normalized = content.trim();
  if (!normalized) return [];
  if (normalized.length <= chunkLimit) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > chunkLimit) {
    const breakpoint = findBreakpoint(remaining, chunkLimit);
    const chunk = remaining.slice(0, breakpoint).trimEnd();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(breakpoint).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function findBreakpoint(content: string, chunkLimit: number): number {
  const slice = content.slice(0, chunkLimit + 1);
  const candidates = [
    slice.lastIndexOf('\n\n'),
    slice.lastIndexOf('\n'),
    slice.lastIndexOf(' '),
  ].filter((index) => index > 0);

  return candidates.length ? Math.max(...candidates) : chunkLimit;
}
