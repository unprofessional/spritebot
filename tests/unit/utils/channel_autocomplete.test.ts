import { buildChannelAutocompleteChoices } from '../../../src/utils/channel_autocomplete';

describe('channel autocomplete', () => {
  test('ranks names deterministically and keeps channel ids invisible', () => {
    const choices = buildChannelAutocompleteChoices(
      [
        { id: '3', name: 'response_archive', kind: 'Text', parentName: 'Operations' },
        { id: '2', name: 'crisis_response', kind: 'Text', parentName: 'Operations' },
        { id: '1', name: 'crisis_response', kind: 'Voice', parentName: 'Voice' },
      ],
      'crisis',
    );

    expect(choices).toEqual([
      { name: 'crisis_response — Text • Operations', value: '2' },
      { name: 'crisis_response — Voice • Voice', value: '1' },
    ]);
    expect(choices.map((choice) => choice.name).join(' ')).not.toMatch(/[123]/);
  });

  test('returns a useful bounded first page and respects Discord label limits', () => {
    const choices = buildChannelAutocompleteChoices(
      Array.from({ length: 30 }, (_, index) => ({
        id: String(index).padStart(2, '0'),
        name: `${'channel'.repeat(20)}-${String(index).padStart(2, '0')}`,
        kind: 'Text' as const,
      })),
      '',
    );

    expect(choices).toHaveLength(25);
    expect(choices.every((choice) => choice.name.length <= 100)).toBe(true);
    expect(choices.map((choice) => choice.value)).toEqual(
      Array.from({ length: 25 }, (_, index) => String(index).padStart(2, '0')),
    );
  });

  test('qualifies duplicate labels without exposing ids', () => {
    expect(
      buildChannelAutocompleteChoices(
        [
          { id: 'duplicate-a', name: 'table', kind: 'Voice', parentName: 'Games' },
          { id: 'duplicate-b', name: 'table', kind: 'Voice', parentName: 'Games' },
        ],
        'table',
      ),
    ).toEqual([
      { name: 'table — Voice • Games • 1', value: 'duplicate-a' },
      { name: 'table — Voice • Games • 2', value: 'duplicate-b' },
    ]);
  });

  test('reserves label space for duplicate qualifiers after truncating long parents', () => {
    const choices = buildChannelAutocompleteChoices(
      [
        { id: 'a', name: 'table', kind: 'Voice', parentName: 'x'.repeat(120) },
        { id: 'b', name: 'table', kind: 'Voice', parentName: 'x'.repeat(120) },
      ],
      'table',
    );

    expect(choices[0]?.name.endsWith(' • 1')).toBe(true);
    expect(choices[1]?.name.endsWith(' • 2')).toBe(true);
    expect(choices[0]?.name).not.toBe(choices[1]?.name);
    expect(choices.every((choice) => choice.name.length <= 100)).toBe(true);
  });
});
