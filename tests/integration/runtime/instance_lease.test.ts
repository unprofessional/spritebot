import { query } from '../../../src/db/client';
import {
  ensureRuntimeInstanceLeaseTable,
  tryAcquireRuntimeInstanceLease,
  waitForRuntimeInstanceLease,
} from '../../../src/runtime/instance_lease';

describe('runtime instance lease', () => {
  test('ensures the lease table idempotently', async () => {
    await expect(ensureRuntimeInstanceLeaseTable()).resolves.toBeUndefined();
    await expect(ensureRuntimeInstanceLeaseTable()).resolves.toBeUndefined();
  });

  test('acquires an empty lease and blocks another active instance', async () => {
    const lease = await tryAcquireRuntimeInstanceLease({
      instanceId: 'instance-1',
      mode: 'active',
      ttlMs: 30_000,
    });

    expect(lease).not.toBeNull();

    await expect(
      tryAcquireRuntimeInstanceLease({
        instanceId: 'instance-2',
        mode: 'active',
        ttlMs: 30_000,
      }),
    ).resolves.toBeNull();
  });

  test('renews the same instance and lets another instance steal an expired lease', async () => {
    const lease = await tryAcquireRuntimeInstanceLease({
      instanceId: 'instance-1',
      mode: 'active',
      ttlMs: 30_000,
    });
    expect(lease).not.toBeNull();

    await expect(
      tryAcquireRuntimeInstanceLease({
        instanceId: 'instance-1',
        mode: 'active',
        ttlMs: 30_000,
      }),
    ).resolves.not.toBeNull();

    await query(
      `
        UPDATE runtime_instance_lease
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
        WHERE lease_key = 'discord-gateway'
      `,
    );

    const stolen = await tryAcquireRuntimeInstanceLease({
      instanceId: 'instance-2',
      mode: 'standby',
      ttlMs: 30_000,
    });

    expect(stolen).not.toBeNull();
    const rows = await query<{ instance_id: string; mode: string }>(
      `SELECT instance_id, mode FROM runtime_instance_lease WHERE lease_key = 'discord-gateway'`,
    );
    expect(rows.rows).toEqual([{ instance_id: 'instance-2', mode: 'standby' }]);
  });

  test('release only removes the lease owned by that instance', async () => {
    const lease = await tryAcquireRuntimeInstanceLease({
      instanceId: 'instance-1',
      mode: 'active',
      ttlMs: 30_000,
    });
    expect(lease).not.toBeNull();

    await lease?.release();

    const rows = await query<{ count: string | number }>(
      `SELECT COUNT(*) AS count FROM runtime_instance_lease`,
    );
    expect(Number(rows.rows[0]?.count ?? 0)).toBe(0);
  });

  test('heartbeat reports a lost lease', async () => {
    const lease = await tryAcquireRuntimeInstanceLease({
      instanceId: 'instance-1',
      mode: 'active',
      ttlMs: 30_000,
    });
    expect(lease).not.toBeNull();

    await query(`DELETE FROM runtime_instance_lease WHERE lease_key = 'discord-gateway'`);

    await expect(lease?.heartbeat()).rejects.toThrow('is no longer owned');
  });

  test('active wait fails fast when the lease is already held', async () => {
    await tryAcquireRuntimeInstanceLease({
      instanceId: 'instance-1',
      mode: 'active',
      ttlMs: 30_000,
    });

    await expect(
      waitForRuntimeInstanceLease({
        instanceId: 'instance-2',
        mode: 'active',
        ttlMs: 30_000,
        pollMs: 5_000,
        logger: { log: jest.fn(), warn: jest.fn() },
      }),
    ).rejects.toThrow('already held by another instance');
  });
});
