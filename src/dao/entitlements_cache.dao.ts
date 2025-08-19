// src/dao/entitlements_cache.dao.ts

import { Pool } from 'pg';
import { pgHost, pgPort, pgUser, pgPass, pgDb } from '../config/env_config';

// Reuse your existing Pool pattern for consistency
const pool = new Pool({
  user: pgUser,
  host: pgHost,
  database: pgDb,
  password: pgPass,
  port: Number(pgPort),
});

// DB row shape
export interface EntitlementRow {
  entitlement_id: string;
  guild_id: string;
  sku_id: string;
  status: 'active' | 'expired' | 'canceled';
  starts_at: Date;
  ends_at: Date | null;
  updated_at: Date;
  raw: Record<string, unknown>;
}

// Input accepted from webhooks/reconciliation (dates can be Date or ISO string)
export interface EntitlementUpsertInput {
  entitlementId: string;
  guildId: string;
  skuId: string;
  status: 'active' | 'expired' | 'canceled';
  startsAt: Date | string;
  endsAt?: Date | string | null;
  raw?: Record<string, unknown>;
}

function toDateOrNull(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v);
}

export class EntitlementsCacheDAO {
  /**
   * Return all currently active entitlements for a guild.
   * Time window is applied here (ends_at is null or in the future).
   */
  async findActiveByGuild(guildId: string): Promise<EntitlementRow[]> {
    const sql = `
      SELECT entitlement_id, guild_id, sku_id, status, starts_at, ends_at, updated_at, raw
      FROM entitlements_cache
      WHERE guild_id = $1
        AND status = 'active'
        AND (ends_at IS NULL OR ends_at > NOW())
      ORDER BY ends_at NULLS LAST, updated_at DESC
    `;
    const res = await pool.query(sql, [guildId]);
    // pg returns strings for timestamptz; if you prefer Date objects, coerce here:
    return res.rows.map((r) => ({
      entitlement_id: r.entitlement_id,
      guild_id: r.guild_id,
      sku_id: r.sku_id,
      status: r.status,
      starts_at: new Date(r.starts_at),
      ends_at: r.ends_at ? new Date(r.ends_at) : null,
      updated_at: new Date(r.updated_at),
      raw: (r.raw ?? {}) as Record<string, unknown>,
    }));
  }

  /**
   * Idempotent upsert from Discord webhook/reconciliation.
   * Uses entitlement_id as the natural key.
   */
  async upsertFromWebhook(input: EntitlementUpsertInput): Promise<void> {
    const { entitlementId, guildId, skuId, status, startsAt, endsAt = null, raw = {} } = input;

    const sql = `
      INSERT INTO entitlements_cache
        (entitlement_id, guild_id, sku_id, status, starts_at, ends_at, raw)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (entitlement_id)
      DO UPDATE SET
        guild_id   = EXCLUDED.guild_id,
        sku_id     = EXCLUDED.sku_id,
        status     = EXCLUDED.status,
        starts_at  = EXCLUDED.starts_at,
        ends_at    = EXCLUDED.ends_at,
        raw        = EXCLUDED.raw,
        updated_at = CURRENT_TIMESTAMP
    `;

    await pool.query(sql, [
      entitlementId,
      guildId,
      skuId,
      status,
      toDateOrNull(startsAt),
      toDateOrNull(endsAt),
      JSON.stringify(raw ?? {}),
    ]);
  }
}
