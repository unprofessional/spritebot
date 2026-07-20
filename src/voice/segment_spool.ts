import { chmod, mkdir, open, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { transcriptionSpoolDir } from '../config/env_config';

type SegmentSpoolParams =
  | {
      guildId: string;
      sessionId: string;
      baseDir?: string;
    }
  | { sessionDir: string };

type WriteSegmentParams = {
  segmentId: string;
  wav: Buffer;
};

export class SegmentSpool {
  readonly sessionDir: string;

  constructor(params: SegmentSpoolParams) {
    this.sessionDir =
      'sessionDir' in params
        ? path.resolve(params.sessionDir)
        : path.join(
            params.baseDir ?? transcriptionSpoolDir,
            `${safePathPart(params.guildId)}-${safePathPart(params.sessionId)}`,
          );
  }

  async initialize(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true, mode: 0o700 });
    await chmod(this.sessionDir, 0o700);
  }

  async writeSegment({ segmentId, wav }: WriteSegmentParams): Promise<string> {
    await this.initialize();
    const relativePath = `segment-${safePathPart(segmentId)}.wav`;
    const filePath = this.resolvePath(relativePath);
    const handle = await open(filePath, 'wx', 0o600);
    try {
      await handle.writeFile(wav);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return relativePath;
  }

  async readSegment(relativePath: string): Promise<Buffer> {
    return readFile(this.resolvePath(relativePath));
  }

  async deleteSegment(relativePath: string): Promise<void> {
    await rm(this.resolvePath(relativePath), { force: true });
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

  private resolvePath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) throw new Error('Segment path must be relative.');
    const resolved = path.resolve(this.sessionDir, relativePath);
    const root = `${path.resolve(this.sessionDir)}${path.sep}`;
    if (!resolved.startsWith(root)) throw new Error('Segment path escapes the session spool.');
    return resolved;
  }
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
