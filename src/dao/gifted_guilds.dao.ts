// src/dao/gifted_guilds.dao.ts

import { Pool } from 'pg';
import { pgHost, pgPort, pgUser, pgPass, pgDb } from '../config/env_config';

const pool = new Pool({
  user: pgUser,
  host: pgHost,
  database: pgDb,
  password: pgPass,
  port: Number(pgPort),
});

// Raw row as returned by PG (strings/timestamps/nulls)
type PgGiftRow = {
  guild_id: string;
  granted_by: string;
  note: string | null;
  expires_at: string | null; // timestamp -> string
  created_at: string; // timestamp -> string
  updated_at: string; // timestamp -> string
};

export interface GiftRow {
  guild_id: string;
  granted_by: string;
  note: string | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface GiftUpsertInput {
  guildId: string;
  grantedBy: string;
  note?: string | null;
  expiresAt?: Date | string | null;
}

function toDateOrNull(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v);
}

function mapRow(r: PgGiftRow): GiftRow {
  return {
    guild_id: r.guild_id,
    granted_by: r.granted_by,
    note: r.note ?? null,
    expires_at: r.expires_at ? new Date(r.expires_at) : null,
    created_at: new Date(r.created_at),
    updated_at: new Date(r.updated_at),
  };
}

export class GiftedGuildsDAO {
  async upsertGift(input: GiftUpsertInput): Promise<GiftRow> {
    const { guildId, grantedBy, note = null, expiresAt = null } = input;
    const expires = toDateOrNull(expiresAt);

    console.debug(
      `[GiftedGuildsDAO] Upserting gift guild=${guildId} grantedBy=${grantedBy} ` +
        `expires=${expires ? expires.toISOString() : 'null'} note="${note ?? ''}"`,
    );

    const sql = `
      INSERT INTO gifted_guilds (guild_id, granted_by, note, expires_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (guild_id)
      DO UPDATE SET
        granted_by = EXCLUDED.granted_by,
        note       = EXCLUDED.note,
        expires_at = EXCLUDED.expires_at,
        updated_at = CURRENT_TIMESTAMP
      RETURNING guild_id, granted_by, note, expires_at, created_at, updated_at
    `;

    const res = await pool.query<PgGiftRow>(sql, [guildId, grantedBy, note, expires]);
    const row = mapRow(res.rows[0]);

    console.debug(
      `[GiftedGuildsDAO] Upsert complete guild=${row.guild_id} ` +
        `expires=${row.expires_at ? row.expires_at.toISOString() : 'null'}`,
    );

    return row;
  }

  async revokeGift(guildId: string): Promise<boolean> {
    console.debug(`[GiftedGuildsDAO] Revoking gift guild=${guildId}`);
    const res = await pool.query(`DELETE FROM gifted_guilds WHERE guild_id = $1`, [guildId]);
    const count = res.rowCount ?? 0; // fix: rowCount possibly undefined
    console.debug(
      `[GiftedGuildsDAO] Revoke ${count ? 'succeeded' : 'no-op (not found)'} guild=${guildId}`,
    );
    return count > 0;
  }

  async isGifted(guildId: string): Promise<boolean> {
    console.debug(`[GiftedGuildsDAO] Checking gifted status guild=${guildId}`);

    const sql = `
      SELECT (expires_at IS NULL OR expires_at > NOW()) AS ok
      FROM gifted_guilds
      WHERE guild_id = $1
      LIMIT 1
    `;
    const res = await pool.query<{ ok: boolean }>(sql, [guildId]);
    const ok = !!res.rows[0]?.ok;

    console.debug(`[GiftedGuildsDAO] Gifted status guild=${guildId} ok=${ok}`);
    return ok;
  }

  async list(options: { limit?: number; offset?: number } = {}): Promise<GiftRow[]> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    console.debug(`[GiftedGuildsDAO] Listing gifts limit=${limit} offset=${offset}`);

    const sql = `
      SELECT guild_id, granted_by, note, expires_at, created_at, updated_at
      FROM gifted_guilds
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const res = await pool.query<PgGiftRow>(sql, [limit, offset]);
    const rows = res.rows.map(mapRow);

    console.debug(`[GiftedGuildsDAO] Listed ${rows.length} gifts`);
    return rows;
  }

  async get(guildId: string): Promise<GiftRow | null> {
    console.debug(`[GiftedGuildsDAO] Fetching gift guild=${guildId}`);
    const sql = `
      SELECT guild_id, granted_by, note, expires_at, created_at, updated_at
      FROM gifted_guilds
      WHERE guild_id = $1
      LIMIT 1
    `;
    const res = await pool.query<PgGiftRow>(sql, [guildId]);
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }
}
