import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  checkDiskSpace,
  evaluateDiskPressure,
  validateSpoolDirectory,
} from '../../../src/voice/durable_queue/disk_util';

describe('durable queue disk utilities', () => {
  test('reports available disk space and validates a writable directory', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'spritebot-disk-test-'));
    try {
      await expect(checkDiskSpace(directory)).resolves.toBeGreaterThan(0);
      const validation = await validateSpoolDirectory(directory);
      expect(validation.writable).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('warns when the configured spool is under /tmp', async () => {
    const directory = path.join('/tmp', `spritebot-spool-validation-${process.pid}`);
    try {
      await expect(validateSpoolDirectory(directory)).resolves.toEqual({
        writable: true,
        persistenceWarning: expect.stringContaining('temporary storage'),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('classifies low and critical disk thresholds', () => {
    expect(evaluateDiskPressure(1000, 500, 100)).toBe('normal');
    expect(evaluateDiskPressure(499, 500, 100)).toBe('low');
    expect(evaluateDiskPressure(99, 500, 100)).toBe('critical');
  });
});
