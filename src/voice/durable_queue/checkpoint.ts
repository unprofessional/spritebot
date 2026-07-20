import { open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { syncDirectory } from './manifest';
import type { TranscriptionResult } from './types';

export type TranscriptCheckpoint = {
  version: 1;
  throughEventSeq: number;
  results: TranscriptionResult[];
};

export async function writeCheckpoint(
  sessionDir: string,
  checkpoint: TranscriptCheckpoint,
): Promise<void> {
  const checkpointPath = path.join(sessionDir, 'checkpoint.json');
  const tempPath = path.join(sessionDir, 'checkpoint.tmp');
  await rm(tempPath, { force: true });
  const handle = await open(tempPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(checkpoint)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, checkpointPath);
  await syncDirectory(sessionDir);
}

export async function readCheckpoint(sessionDir: string): Promise<TranscriptCheckpoint | null> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(sessionDir, 'checkpoint.json'), 'utf8'),
    ) as Partial<TranscriptCheckpoint>;
    if (
      parsed.version !== 1 ||
      !Number.isSafeInteger(parsed.throughEventSeq) ||
      !Array.isArray(parsed.results)
    ) {
      return null;
    }
    return parsed as TranscriptCheckpoint;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null;
    return null;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}
