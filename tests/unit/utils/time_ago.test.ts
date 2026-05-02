import { formatTimeAgo } from '../../../src/utils/time_ago';

describe('formatTimeAgo', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-01T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('formats recent timestamps as just now', () => {
    expect(formatTimeAgo('2026-05-01T11:59:45.000Z')).toBe('just now');
  });

  test('formats minutes, hours, and days', () => {
    expect(formatTimeAgo('2026-05-01T11:55:00.000Z')).toBe('5m ago');
    expect(formatTimeAgo('2026-05-01T09:00:00.000Z')).toBe('3h ago');
    expect(formatTimeAgo('2026-04-29T12:00:00.000Z')).toBe('2d ago');
  });
});
