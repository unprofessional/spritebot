import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SegmentSpool } from '../../../src/voice/segment_spool';

describe('SegmentSpool', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), 'spritebot-spool-test-'));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  test('writes segments to a durable session directory', async () => {
    const spool = new SegmentSpool({
      guildId: 'guild/one',
      sessionId: 'session:one',
      baseDir,
    });

    const filePath = await spool.writeSegment({
      segmentId: 1,
      userId: 'user/one',
      timestamp: new Date('2026-07-15T05:00:00.000Z'),
      wav: Buffer.from('wav data'),
    });

    await expect(spool.readSegment(filePath)).resolves.toEqual(Buffer.from('wav data'));
    await expect(SegmentSpool.findRecoverableSessions(baseDir)).resolves.toEqual([
      spool.sessionDir,
    ]);
    expect(filePath).toContain('segment-000001-user_one-');
  });

  test('cleanup removes the session directory', async () => {
    const spool = new SegmentSpool({
      guildId: 'guild-1',
      sessionId: 'session-1',
      baseDir,
    });
    await spool.writeSegment({
      segmentId: 1,
      userId: 'user-1',
      timestamp: new Date('2026-07-15T05:00:00.000Z'),
      wav: Buffer.from('wav data'),
    });

    await spool.cleanup();

    await expect(SegmentSpool.findRecoverableSessions(baseDir)).resolves.toEqual([]);
  });
});
