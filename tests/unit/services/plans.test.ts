import { FEATURE_LABELS } from '../../../src/access/features';
import { featuresForSkus } from '../../../src/services/plans';

describe('subscription plan feature bundles', () => {
  test('includes TaleSpire integration in the Premium SKU', () => {
    expect(featuresForSkus(['1405308360818954322'])).toContain('integrations:talespire');
  });

  test('exposes a user-facing label for the TaleSpire feature', () => {
    expect(FEATURE_LABELS['integrations:talespire']).toBe('TaleSpire Integration');
  });

  test('does not grant TaleSpire integration for an unknown SKU', () => {
    expect(featuresForSkus(['unknown-sku'])).toEqual(new Set(['core']));
  });
});
