import { access, mkdir, open, readFile, rm, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export type SpoolValidation = {
  writable: boolean;
  persistenceWarning: string | null;
};

export type DiskPressure = 'normal' | 'low' | 'critical';

export async function checkDiskSpace(targetPath: string): Promise<number> {
  const stats = await statfs(targetPath);
  return (Number(stats.bavail) * Number(stats.bsize)) / (1024 * 1024);
}

export function evaluateDiskPressure(
  availableMb: number,
  lowDiskMb: number,
  criticalDiskMb: number,
): DiskPressure {
  if (availableMb < criticalDiskMb) return 'critical';
  if (availableMb < lowDiskMb) return 'low';
  return 'normal';
}

export async function validateSpoolDirectory(baseDir: string): Promise<SpoolValidation> {
  await mkdir(baseDir, { recursive: true, mode: 0o700 });
  let writable = true;
  try {
    await access(baseDir, constants.W_OK);
    const probePath = path.join(baseDir, `.write-probe-${process.pid}`);
    const probe = await open(probePath, 'wx', 0o600);
    await probe.close();
    await rm(probePath, { force: true });
  } catch {
    writable = false;
  }

  const normalized = path.resolve(baseDir);
  const filesystemType = await linuxFilesystemType(normalized);
  const isTemporaryFilesystem = filesystemType === 'tmpfs' || filesystemType === 'ramfs';
  const isTemporaryPath = normalized === '/tmp' || normalized.startsWith('/tmp/');
  const persistenceWarning =
    isTemporaryFilesystem || isTemporaryPath
      ? `Transcription spool ${normalized} is on temporary storage (${filesystemType ?? '/tmp'}) and may not survive container replacement.`
      : null;
  return { writable, persistenceWarning };
}

async function linuxFilesystemType(targetPath: string): Promise<string | null> {
  const mountInfo = await readFile('/proc/self/mountinfo', 'utf8').catch(() => null);
  if (!mountInfo) return null;
  let best: { mountPoint: string; filesystemType: string } | null = null;
  for (const line of mountInfo.split('\n')) {
    const [mountFields, filesystemFields] = line.split(' - ');
    if (!mountFields || !filesystemFields) continue;
    const mountPoint = decodeMountPath(mountFields.split(' ')[4] ?? '');
    const filesystemType = filesystemFields.split(' ')[0] ?? '';
    if (
      mountPoint &&
      filesystemType &&
      isWithinMount(mountPoint, targetPath) &&
      (!best || mountPoint.length > best.mountPoint.length)
    ) {
      best = { mountPoint, filesystemType };
    }
  }
  return best?.filesystemType ?? null;
}

function decodeMountPath(value: string): string {
  return value
    .replaceAll('\\040', ' ')
    .replaceAll('\\011', '\t')
    .replaceAll('\\012', '\n')
    .replaceAll('\\134', '\\');
}

function isWithinMount(mountPoint: string, targetPath: string): boolean {
  if (mountPoint === '/') return targetPath.startsWith('/');
  return targetPath === mountPoint || targetPath.startsWith(`${mountPoint}/`);
}
