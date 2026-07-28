const CUSTOM_STAT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export function isValidCustomStatKey(value: unknown): value is string {
  return typeof value === 'string' && CUSTOM_STAT_KEY_PATTERN.test(value);
}
