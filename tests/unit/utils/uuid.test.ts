import { isUuid } from '../../../src/utils/uuid';

describe('isUuid', () => {
  test('accepts UUIDs and rejects malformed entity IDs before database access', () => {
    expect(isUuid('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
    expect(isUuid('test')).toBe(false);
    expect(isUuid('123e4567-e89b-12d3-a456-42661417400z')).toBe(false);
  });
});
