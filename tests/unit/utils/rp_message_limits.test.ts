import {
  RP_PROXY_CHUNK_CHARACTER_LIMIT,
  RP_PROXY_TOTAL_CHARACTER_LIMIT,
  splitRpMessage,
} from '../../../src/utils/rp_message_limits';

describe('rp_message_limits', () => {
  test('keeps short messages as a single chunk', () => {
    expect(splitRpMessage('hello there')).toEqual(['hello there']);
  });

  test('splits messages above the Discord per-message cap', () => {
    const content = `${'a'.repeat(RP_PROXY_CHUNK_CHARACTER_LIMIT)} ${'b'.repeat(50)}`;

    const chunks = splitRpMessage(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].length).toBeLessThanOrEqual(RP_PROXY_CHUNK_CHARACTER_LIMIT);
    expect(chunks[1]).toBe('b'.repeat(50));
  });

  test('supports the 4000 character Nitro-sized proxy cap in two chunks', () => {
    const content = 'x'.repeat(RP_PROXY_TOTAL_CHARACTER_LIMIT);

    const chunks = splitRpMessage(content);

    expect(chunks).toHaveLength(2);
    expect(chunks.join('')).toHaveLength(RP_PROXY_TOTAL_CHARACTER_LIMIT);
    expect(chunks.every((chunk) => chunk.length <= RP_PROXY_CHUNK_CHARACTER_LIMIT)).toBe(true);
  });
});
