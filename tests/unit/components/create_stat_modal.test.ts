import { build } from '../../../src/components/create_stat_modal';

describe('create stat modal', () => {
  test('labels and collects both count defaults', () => {
    const modal = build('game-1', 'count').toJSON();
    const inputs = modal.components.map((row) => row.components[0]);

    expect(inputs).toEqual([
      expect.objectContaining({ custom_id: 'label' }),
      expect.objectContaining({
        custom_id: 'stat_key',
        label: 'Stable Key (e.g. hp, stress, ammo)',
        required: true,
      }),
      expect.objectContaining({
        custom_id: 'default_value',
        label: 'Default MAX Value (optional)',
      }),
      expect.objectContaining({
        custom_id: 'default_current',
        label: 'Default CURRENT Value (optional)',
      }),
      expect.objectContaining({ custom_id: 'sort_index' }),
    ]);
  });

  test('keeps the single generic default for non-count stats', () => {
    const modal = build('game-1', 'number').toJSON();
    const inputs = modal.components.map((row) => row.components[0]);

    expect(inputs).toHaveLength(4);
    expect(inputs).toContainEqual(
      expect.objectContaining({
        custom_id: 'default_value',
        label: 'Default Value (optional)',
      }),
    );
  });
});
