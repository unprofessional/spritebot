import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

import { query } from '../db/client';
import { isDraining } from './lifecycle';

export type RuntimeInstanceMode = 'active' | 'standby';

export type RuntimeLeaseRow = {
  lease_key: string;
  instance_id: string;
  mode: RuntimeInstanceMode;
  acquired_at: Date;
  heartbeat_at: Date;
  expires_at: Date;
};

export type RuntimeInstanceLeaseOptions = {
  leaseKey?: string;
  instanceId: string;
  mode: RuntimeInstanceMode;
  ttlMs: number;
  metadata?: Record<string, unknown>;
};

export type WaitForRuntimeInstanceLeaseOptions = RuntimeInstanceLeaseOptions & {
  pollMs: number;
  logger?: Pick<Console, 'log' | 'warn'>;
};

export class RuntimeInstanceLease {
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private released = false;

  constructor(
    readonly leaseKey: string,
    readonly instanceId: string,
    readonly mode: RuntimeInstanceMode,
    private readonly ttlMs: number,
  ) {}

  startHeartbeat({
    intervalMs,
    logger = console,
    onLost,
  }: {
    intervalMs: number;
    logger?: Pick<Console, 'log' | 'warn'>;
    onLost?: (error: Error) => void;
  }): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(
      () => {
        void this.heartbeat().catch((error) => {
          logger.warn('[runtime-lease] heartbeat failed:', error);
          this.stopHeartbeat();
          onLost?.(error instanceof Error ? error : new Error(String(error)));
        });
      },
      Math.max(1_000, intervalMs),
    );
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  async heartbeat(): Promise<void> {
    if (this.released) return;

    const result = await query<{ lease_key: string }>(
      `
        UPDATE runtime_instance_lease
        SET heartbeat_at = CURRENT_TIMESTAMP,
            expires_at = $3
        WHERE lease_key = $1
          AND instance_id = $2
        RETURNING lease_key
      `,
      [this.leaseKey, this.instanceId, expiresAt(this.ttlMs)],
      { allowDuringDrain: true },
    );

    if (result.rowCount !== 1) {
      throw new Error(`Runtime lease ${this.leaseKey} is no longer owned by ${this.instanceId}.`);
    }
  }

  async release(): Promise<void> {
    if (this.released) return;

    this.released = true;
    this.stopHeartbeat();
    await query(
      `
        DELETE FROM runtime_instance_lease
        WHERE lease_key = $1
          AND instance_id = $2
      `,
      [this.leaseKey, this.instanceId],
      { allowDuringDrain: true },
    );
  }
}

export function createRuntimeInstanceId(): string {
  return `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
}

export async function ensureRuntimeInstanceLeaseTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS runtime_instance_lease (
      lease_key TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('active', 'standby')),
      acquired_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMPTZ NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_runtime_instance_lease_expires_at
      ON runtime_instance_lease(expires_at)
  `);
}

export async function tryAcquireRuntimeInstanceLease({
  leaseKey = 'discord-gateway',
  instanceId,
  mode,
  ttlMs,
  metadata = {},
}: RuntimeInstanceLeaseOptions): Promise<RuntimeInstanceLease | null> {
  const result = await query<RuntimeLeaseRow>(
    `
      INSERT INTO runtime_instance_lease (
        lease_key,
        instance_id,
        mode,
        acquired_at,
        heartbeat_at,
        expires_at,
        metadata
      )
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4, $5::jsonb)
      ON CONFLICT (lease_key) DO UPDATE
        SET instance_id = EXCLUDED.instance_id,
            mode = EXCLUDED.mode,
            acquired_at = CASE
              WHEN runtime_instance_lease.instance_id = EXCLUDED.instance_id
                THEN runtime_instance_lease.acquired_at
              ELSE CURRENT_TIMESTAMP
            END,
            heartbeat_at = CURRENT_TIMESTAMP,
            expires_at = EXCLUDED.expires_at,
            metadata = EXCLUDED.metadata
      WHERE runtime_instance_lease.instance_id = EXCLUDED.instance_id
         OR runtime_instance_lease.expires_at <= CURRENT_TIMESTAMP
      RETURNING lease_key, instance_id, mode, acquired_at, heartbeat_at, expires_at
    `,
    [leaseKey, instanceId, mode, expiresAt(ttlMs), JSON.stringify(metadata)],
  );

  if (result.rowCount !== 1) return null;

  return new RuntimeInstanceLease(leaseKey, instanceId, mode, ttlMs);
}

export async function waitForRuntimeInstanceLease({
  pollMs,
  logger = console,
  ...options
}: WaitForRuntimeInstanceLeaseOptions): Promise<RuntimeInstanceLease> {
  while (!isDraining()) {
    const lease = await tryAcquireRuntimeInstanceLease(options);
    if (lease) {
      logger.log(
        `[runtime-lease] acquired ${lease.leaseKey} as ${lease.instanceId} (${lease.mode})`,
      );
      return lease;
    }

    if (options.mode === 'active') {
      throw new Error(
        `Runtime lease ${options.leaseKey ?? 'discord-gateway'} is already held by another instance.`,
      );
    }

    logger.log(
      `[runtime-lease] standby waiting for ${options.leaseKey ?? 'discord-gateway'} lease...`,
    );
    await sleep(pollMs);
  }

  throw new Error('Runtime lease wait aborted because shutdown is in progress.');
}

function expiresAt(ttlMs: number): string {
  return new Date(Date.now() + Math.max(1_000, ttlMs)).toISOString();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, Math.max(1_000, ms)));
}
