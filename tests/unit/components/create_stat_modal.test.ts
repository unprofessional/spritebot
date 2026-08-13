import { build } from '../../../src/components/create_stat_modal';

describe('create stat modal', () => {
  test('labels and collects both count defaults', () => {
    const modal = build('game-1', 'count').toJSON();
    const inputs = modal.components.map((label) => label.component);

    expect(inputs).toEqual([
      expect.objectContaining({ custom_id: 'label' }),
      expect.objectContaining({
        custom_id: 'stat_key',
        required: true,
      }),
      expect.objectContaining({
        custom_id: 'default_value',
      }),
      expect.objectContaining({
        custom_id: 'default_current',
      }),
      expect.objectContaining({ custom_id: 'sort_index' }),
    ]);
  });

  test('keeps the single generic default for non-count stats', () => {
    const modal = build('game-1', 'number').toJSON();
    const inputs = modal.components.map((label) => label.component);

    expect(inputs).toHaveLength(4);
    expect(inputs).toContainEqual(
      expect.objectContaining({
        custom_id: 'default_value',
      }),
    );
  });
});
