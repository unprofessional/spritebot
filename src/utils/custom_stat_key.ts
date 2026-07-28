const CUSTOM_STAT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export function isValidCustomStatKey(value: string): boolean {
  return CUSTOM_STAT_KEY_PATTERN.test(value);
}

export function normalizeCustomStatKey(value: string): string {
  let normalized = value
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) normalized = 'stat';
  if (!/^[a-z]/.test(normalized)) normalized = `stat_${normalized}`;
  return normalized.slice(0, 64).replace(/_+$/g, '') || 'stat';
}
