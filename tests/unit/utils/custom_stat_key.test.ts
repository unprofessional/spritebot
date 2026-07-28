import { isValidCustomStatKey, normalizeCustomStatKey } from '../../../src/utils/custom_stat_key';

describe('custom stat keys', () => {
  test.each([
    ['HP / Max', 'hp_max'],
    ['123 Stress!', 'stat_123_stress'],
    ['Élan', 'lan'],
    ['心', 'stat'],
    ['___Ammo___', 'ammo'],
  ])('normalizes %p to the same conservative ASCII shape as SQL backfill', (input, expected) => {
    expect(normalizeCustomStatKey(input)).toBe(expected);
    expect(isValidCustomStatKey(expected)).toBe(true);
  });

  test('caps normalized keys at 64 characters', () => {
    const key = normalizeCustomStatKey(`Stat ${'x'.repeat(100)}`);
    expect(key).toHaveLength(64);
    expect(isValidCustomStatKey(key)).toBe(true);
  });

  test.each(['HP', '1hp', 'health-points', 'health points', '', `a${'b'.repeat(64)}`])(
    'rejects invalid explicit key %p',
    (key) => {
      expect(isValidCustomStatKey(key)).toBe(false);
    },
  );
});
