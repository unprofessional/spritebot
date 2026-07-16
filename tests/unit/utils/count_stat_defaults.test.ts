import type { StatTemplate } from '../../../src/types/stat_template';
import {
  applyCountStatDefaultsToDraft,
  formatStatTemplateDefault,
  getCountStatDefaults,
  parseCountDefault,
  withDefaultCurrent,
} from '../../../src/utils/count_stat_defaults';

function countTemplate(overrides: Partial<StatTemplate> = {}): StatTemplate {
  return {
    id: 'stat-1',
    game_id: 'game-1',
    label: 'HP',
    field_type: 'count',
    default_value: '10',
    is_required: true,
    sort_order: 0,
    meta: {},
    ...overrides,
  };
}

describe('count stat defaults', () => {
  test('uses max as current when no explicit current default exists', () => {
    expect(getCountStatDefaults(countTemplate())).toEqual({ max: 10, current: 10 });
    expect(formatStatTemplateDefault(countTemplate())).toBe('10 / 10');
  });

  test('reads an explicit current default from template metadata', () => {
    const template = countTemplate({ meta: { default_current: 4 } });

    expect(getCountStatDefaults(template)).toEqual({ max: 10, current: 4 });
    expect(formatStatTemplateDefault(template)).toBe('4 / 10');
  });

  test('accepts only non-negative safe whole-number defaults', () => {
    expect(parseCountDefault('0')).toBe(0);
    expect(parseCountDefault('12')).toBe(12);
    expect(parseCountDefault('-1')).toBeNull();
    expect(parseCountDefault('1.5')).toBeNull();
    expect(parseCountDefault('twelve')).toBeNull();
  });

  test('updates current metadata without removing unrelated metadata', () => {
    expect(withDefaultCurrent({ note: 'preserve' }, 4)).toEqual({
      note: 'preserve',
      default_current: 4,
    });
    expect(withDefaultCurrent({ note: 'preserve', default_current: 4 }, null)).toEqual({
      note: 'preserve',
    });
  });

  test('applies count defaults to an empty draft without overwriting player input', () => {
    const draftData: Record<string, unknown> = {};
    const template = countTemplate({ meta: { default_current: 4 } });

    applyCountStatDefaultsToDraft(draftData, [template]);
    expect(draftData).toEqual({
      'game:stat-1': null,
      'meta:game:stat-1': { max: 10, current: 4 },
    });

    draftData['meta:game:stat-1'] = { max: 8, current: 3 };
    applyCountStatDefaultsToDraft(draftData, [template]);
    expect(draftData['meta:game:stat-1']).toEqual({ max: 8, current: 3 });
  });
});
