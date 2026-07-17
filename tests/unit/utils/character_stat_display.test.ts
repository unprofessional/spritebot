import { formatCharacterStatValue } from '../../../src/utils/character_stat_display';

describe('formatCharacterStatValue', () => {
  test('formats count stats as current over max', () => {
    expect(
      formatCharacterStatValue({
        field_type: 'count',
        value: '',
        meta: { current: 8, max: 12 },
      }),
    ).toBe('8 / 12');
  });

  test('defaults count current to max and accepts legacy numeric strings', () => {
    expect(formatCharacterStatValue({ field_type: 'count', meta: { max: '12' } })).toBe('12 / 12');
  });

  test('returns null for count stats without a valid max', () => {
    expect(formatCharacterStatValue({ field_type: 'count', meta: { current: 8 } })).toBeNull();
    expect(formatCharacterStatValue({ field_type: 'count', meta: { max: 'invalid' } })).toBeNull();
  });

  test('normalizes ordinary stat values and preserves zero', () => {
    expect(formatCharacterStatValue({ field_type: 'short', value: '  Wizard  ' })).toBe('Wizard');
    expect(formatCharacterStatValue({ field_type: 'number', value: 0 })).toBe('0');
    expect(formatCharacterStatValue({ field_type: 'short', value: '   ' })).toBeNull();
  });
});
