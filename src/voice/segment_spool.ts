import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { transcriptionSpoolDir } from '../config/env_config';

type SegmentSpoolParams = {
  guildId: string;
  sessionId: string;
  baseDir?: string;
};

type WriteSegmentParams = {
  segmentId: number;
  userId: string;
  timestamp: Date;
  wav: Buffer;
};

export class SegmentSpool {
  readonly sessionDir: string;

  constructor({ guildId, sessionId, baseDir = transcriptionSpoolDir }: SegmentSpoolParams) {
    this.sessionDir = path.join(baseDir, `${safePathPart(guildId)}-${safePathPart(sessionId)}`);
  }

  async initialize(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
  }

  async writeSegment({ segmentId, userId, timestamp, wav }: WriteSegmentParams): Promise<string> {
    await this.initialize();
    const filePath = path.join(
      this.sessionDir,
      `segment-${String(segmentId).padStart(6, '0')}-${safePathPart(userId)}-${timestamp.getTime()}.wav`,
    );
    await writeFile(filePath, wav);
    return filePath;
  }

  async readSegment(filePath: string): Promise<Buffer> {
    return readFile(filePath);
  }

  async cleanup(): Promise<void> {
    await rm(this.sessionDir, { recursive: true, force: true });
  }

  static async findRecoverableSessions(baseDir = transcriptionSpoolDir): Promise<string[]> {
    const entries = await readdir(baseDir, { withFileTypes: true }).catch((err: unknown) => {
      if (isNodeError(err) && err.code === 'ENOENT') return [];
      throw err;
    });

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(baseDir, entry.name))
      .sort();
  }
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
