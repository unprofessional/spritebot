// src/services/discord_entitlements_api.ts

/**
 * Minimal Discord Entitlements API client (lazy pull).
 * Docs: GET /applications/{application_id}/entitlements
 * Auth: Bot {TOKEN}
 *
 * We filter in code for:
 *  - guild-scoped entitlements
 *  - active/valid (ends_at null or > now)
 */

const API_BASE = 'https://discord.com/api/v10';

export type DiscordEntitlement = {
  id: string;
  sku_id: string;
  user_id?: string | null;
  guild_id?: string | null;
  application_id: string;
  starts_at?: string | null; // ISO
  ends_at?: string | null; // ISO
  // ... other fields are ignored
};

export async function fetchGuildEntitlementsLazy(opts: {
  applicationId: string;
  botToken: string;
  guildId: string;
  limit?: number; // default 100
}): Promise<DiscordEntitlement[]> {
  const { applicationId, botToken, guildId, limit = 100 } = opts;

  const url = new URL(`${API_BASE}/applications/${applicationId}/entitlements`);
  url.searchParams.set('guild_id', guildId);
  url.searchParams.set('limit', String(limit));

  console.debug(
    `[EntitlementsAPI] Fetching entitlements for guild=${guildId} app=${applicationId} limit=${limit}`,
  );

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
  });

  console.debug(
    `[EntitlementsAPI] Response status ${res.status} ${res.statusText} for guild=${guildId}`,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(
      `[EntitlementsAPI] Failed fetch for guild=${guildId} status=${res.status} body="${text}"`,
    );
    throw new Error(`Discord entitlements fetch failed (${res.status} ${res.statusText}): ${text}`);
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    console.warn(`[EntitlementsAPI] Non-array response for guild=${guildId}, ignoring`);
    return [];
  }

  console.debug(`[EntitlementsAPI] Received ${data.length} entitlements for guild=${guildId}`);

  const mapped = data.map((e: any) => ({
    id: String(e.id),
    sku_id: String(e.sku_id),
    user_id: e.user_id ? String(e.user_id) : null,
    guild_id: e.guild_id ? String(e.guild_id) : null,
    application_id: String(e.application_id),
    starts_at: e.starts_at ?? null,
    ends_at: e.ends_at ?? null,
  }));

  for (const ent of mapped) {
    console.debug(
      `[EntitlementsAPI] Entitlement id=${ent.id} sku=${ent.sku_id} ` +
        `guild=${ent.guild_id ?? 'n/a'} user=${ent.user_id ?? 'n/a'} ` +
        `starts=${ent.starts_at ?? 'none'} ends=${ent.ends_at ?? 'none'}`,
    );
  }

  console.debug(`[EntitlementsAPI] Normalized ${mapped.length} entitlements for guild=${guildId}`);

  return mapped;
}
