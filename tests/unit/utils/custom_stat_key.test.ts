import { isValidCustomStatKey } from '../../../src/utils/custom_stat_key';

describe('custom stat keys', () => {
  test.each(['HP', '1hp', 'health-points', 'health points', '', `a${'b'.repeat(64)}`])(
    'rejects invalid explicit key %p',
    (key) => {
      expect(isValidCustomStatKey(key)).toBe(false);
    },
  );

  test.each(['hp', 'hp_max', 'stress2', `a${'b'.repeat(63)}`])(
    'accepts valid explicit key %p',
    (key) => {
      expect(isValidCustomStatKey(key)).toBe(true);
    },
  );
});
