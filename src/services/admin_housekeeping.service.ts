import { query, type DbClient } from '../db/client';

export interface HousekeepingExample {
  id: string;
  name: string;
  detail: string;
}

export interface HousekeepingCategory {
  category: string;
  label: string;
  count: number;
  examples: HousekeepingExample[];
  safeToPurge: boolean;
}

export interface HousekeepingPurgeResult {
  category: string;
  label: string;
  count: number;
}

export interface ThreadBumpCheckCandidate {
  threadId: string;
  guildId: string;
  detail: string;
}

export interface GameAuditRow {
  id: string;
  name: string;
  createdBy: string;
  isPublic: boolean;
  createdAt: string;
  statTemplateCount: number;
  characterCount: number;
  publicCharacterCount: number;
  privateCharacterCount: number;
  lastActivityAt: string;
  inactiveOver60Days: boolean;
}

export interface PrivateCharacterAuditRow {
  id: string;
  name: string;
  gameId: string;
  gameName: string;
  ownerId: string;
  createdAt: string;
  filledStatCount: number;
  totalStatCount: number;
  hasNoFilledStats: boolean;
}

export interface GlobalStats {
  activeSubscriberGuilds: number;
  activeGiftedGuilds: number;
  activeAccessGuilds: number;
  publicGames: number;
  totalGames: number;
  publicCharacters: number;
  totalActiveCharacters: number;
  linkedPlayers: number;
}

type QueryClient = Pick<DbClient, 'query'>;

const DEFAULT_CLIENT: QueryClient = { query };
const EXAMPLE_LIMIT = 3;

interface CategoryDefinition {
  category: string;
  label: string;
  safeToPurge: boolean;
  countSql: string;
  examplesSql: string;
}

type CountRow = { count: string | number };
type ExampleRow = { id: string; name: string | null; detail: string | null };
type PurgeRow = {
  soft_deleted_characters: string | number;
  stale_proxy_messages: string | number;
  stale_channel_modes: string | number;
  expired_gifted_guilds: string | number;
  stale_entitlements: string | number;
};

const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  {
    category: 'abandoned-games',
    label: '🎲 Abandoned games (unpublished, no stats, no characters)',
    safeToPurge: false,
    countSql: `
      SELECT COUNT(*) AS count
      FROM game g
      WHERE g.is_public = FALSE
        AND g.created_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
        AND NOT EXISTS (SELECT 1 FROM stat_template st WHERE st.game_id = g.id)
        AND NOT EXISTS (
          SELECT 1 FROM character c WHERE c.game_id = g.id AND c.deleted_at IS NULL
        )
    `,
    examplesSql: `
      SELECT g.id::text AS id,
             g.name AS name,
             'created ' || g.created_at::text AS detail
      FROM game g
      WHERE g.is_public = FALSE
        AND g.created_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
        AND NOT EXISTS (SELECT 1 FROM stat_template st WHERE st.game_id = g.id)
        AND NOT EXISTS (
          SELECT 1 FROM character c WHERE c.game_id = g.id AND c.deleted_at IS NULL
        )
      ORDER BY g.created_at ASC
      LIMIT $1
    `,
  },
  {
    category: 'empty-published-games',
    label: '📢 Published games with no players',
    safeToPurge: false,
    countSql: `
      SELECT COUNT(*) AS count
      FROM game g
      WHERE g.is_public = TRUE
        AND g.created_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
        AND NOT EXISTS (
          SELECT 1 FROM character c WHERE c.game_id = g.id AND c.deleted_at IS NULL
        )
    `,
    examplesSql: `
      SELECT g.id::text AS id,
             g.name AS name,
             'published, created ' || g.created_at::text AS detail
      FROM game g
      WHERE g.is_public = TRUE
        AND g.created_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
        AND NOT EXISTS (
          SELECT 1 FROM character c WHERE c.game_id = g.id AND c.deleted_at IS NULL
        )
      ORDER BY g.created_at ASC
      LIMIT $1
    `,
  },
  {
    category: 'orphaned-player-links',
    label: '🔗 Orphaned player links',
    safeToPurge: false,
    countSql: `
      SELECT COUNT(*) AS count
      FROM player_server_link psl
      LEFT JOIN game g ON psl.current_game_id = g.id
      LEFT JOIN character c ON psl.current_character_id = c.id
      WHERE (psl.current_game_id IS NOT NULL AND g.id IS NULL)
         OR (psl.current_character_id IS NOT NULL AND c.id IS NULL)
    `,
    examplesSql: `
      SELECT psl.id::text AS id,
             p.discord_id AS name,
             CASE
               WHEN psl.current_game_id IS NOT NULL AND g.id IS NULL THEN 'missing game ' || psl.current_game_id::text
               WHEN psl.current_character_id IS NOT NULL AND c.id IS NULL THEN 'missing character ' || psl.current_character_id::text
               ELSE 'unknown orphan'
             END AS detail
      FROM player_server_link psl
      JOIN player p ON p.id = psl.player_id
      LEFT JOIN game g ON psl.current_game_id = g.id
      LEFT JOIN character c ON psl.current_character_id = c.id
      WHERE (psl.current_game_id IS NOT NULL AND g.id IS NULL)
         OR (psl.current_character_id IS NOT NULL AND c.id IS NULL)
      ORDER BY psl.updated_at ASC
      LIMIT $1
    `,
  },
  {
    category: 'soft-deleted-characters',
    label: '🪦 Soft-deleted characters (>30 days)',
    safeToPurge: true,
    countSql: `
      SELECT COUNT(*) AS count
      FROM character c
      WHERE c.deleted_at IS NOT NULL
        AND c.deleted_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
    `,
    examplesSql: `
      SELECT c.id::text AS id,
             c.name AS name,
             'deleted ' || c.deleted_at::text AS detail
      FROM character c
      WHERE c.deleted_at IS NOT NULL
        AND c.deleted_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
      ORDER BY c.deleted_at ASC
      LIMIT $1
    `,
  },
  {
    category: 'stale-proxy-messages',
    label: '📨 Stale proxy message mappings (>90 days)',
    safeToPurge: true,
    countSql: `
      SELECT COUNT(*) AS count
      FROM rp_proxy_message rpm
      WHERE rpm.created_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
    `,
    examplesSql: `
      SELECT rpm.proxy_message_id AS id,
             rpm.channel_id AS name,
             'created ' || rpm.created_at::text AS detail
      FROM rp_proxy_message rpm
      WHERE rpm.created_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
      ORDER BY rpm.created_at ASC
      LIMIT $1
    `,
  },
  {
    category: 'stale-channel-modes',
    label: '🎭 Stale IC channel modes (>90 days)',
    safeToPurge: true,
    countSql: `
      SELECT COUNT(*) AS count
      FROM rp_channel_mode rcm
      WHERE rcm.updated_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
    `,
    examplesSql: `
      SELECT rcm.guild_id || ':' || rcm.channel_id || ':' || rcm.user_id AS id,
             rcm.channel_id AS name,
             'updated ' || rcm.updated_at::text AS detail
      FROM rp_channel_mode rcm
      WHERE rcm.updated_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
      ORDER BY rcm.updated_at ASC
      LIMIT $1
    `,
  },
  {
    category: 'expired-gifted-guilds',
    label: '🎁 Expired gift entries',
    safeToPurge: true,
    countSql: `
      SELECT COUNT(*) AS count
      FROM gifted_guilds gg
      WHERE gg.expires_at IS NOT NULL
        AND gg.expires_at < CURRENT_TIMESTAMP
    `,
    examplesSql: `
      SELECT gg.guild_id AS id,
             gg.guild_id AS name,
             'expired ' || gg.expires_at::text AS detail
      FROM gifted_guilds gg
      WHERE gg.expires_at IS NOT NULL
        AND gg.expires_at < CURRENT_TIMESTAMP
      ORDER BY gg.expires_at ASC
      LIMIT $1
    `,
  },
  {
    category: 'stale-entitlements',
    label: '💳 Stale entitlement cache entries',
    safeToPurge: true,
    countSql: `
      SELECT COUNT(*) AS count
      FROM entitlements_cache ec
      WHERE ec.status IN ('expired', 'canceled')
        AND ec.updated_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
    `,
    examplesSql: `
      SELECT ec.entitlement_id AS id,
             ec.guild_id AS name,
             ec.status || ', updated ' || ec.updated_at::text AS detail
      FROM entitlements_cache ec
      WHERE ec.status IN ('expired', 'canceled')
        AND ec.updated_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
      ORDER BY ec.updated_at ASC
      LIMIT $1
    `,
  },
];

function toCount(value: string | number | undefined): number {
  return Number(value ?? 0);
}

function mapExample(row: ExampleRow): HousekeepingExample {
  return {
    id: row.id,
    name: row.name ?? row.id,
    detail: row.detail ?? '',
  };
}

async function runCategory(
  definition: CategoryDefinition,
  client: QueryClient,
): Promise<HousekeepingCategory> {
  const [countResult, examplesResult] = await Promise.all([
    client.query<CountRow>(definition.countSql),
    client.query<ExampleRow>(definition.examplesSql, [EXAMPLE_LIMIT]),
  ]);

  return {
    category: definition.category,
    label: definition.label,
    safeToPurge: definition.safeToPurge,
    count: toCount(countResult.rows[0]?.count),
    examples: examplesResult.rows.map(mapExample),
  };
}

export async function getOrphanReport(
  client: QueryClient = DEFAULT_CLIENT,
): Promise<HousekeepingCategory[]> {
  return Promise.all(CATEGORY_DEFINITIONS.map((definition) => runCategory(definition, client)));
}

function labelForCategory(category: string): string {
  return (
    CATEGORY_DEFINITIONS.find((definition) => definition.category === category)?.label ?? category
  );
}

export async function purgeSafeOrphans(
  client: QueryClient = DEFAULT_CLIENT,
): Promise<HousekeepingPurgeResult[]> {
  const result = await client.query<PurgeRow>(`
    WITH deleted_characters AS (
      DELETE FROM character c
      WHERE c.deleted_at IS NOT NULL
        AND c.deleted_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
      RETURNING 1
    ),
    deleted_proxy_messages AS (
      DELETE FROM rp_proxy_message rpm
      WHERE rpm.created_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
      RETURNING 1
    ),
    deleted_channel_modes AS (
      DELETE FROM rp_channel_mode rcm
      WHERE rcm.updated_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
      RETURNING 1
    ),
    deleted_gifted_guilds AS (
      DELETE FROM gifted_guilds gg
      WHERE gg.expires_at IS NOT NULL
        AND gg.expires_at < CURRENT_TIMESTAMP
      RETURNING 1
    ),
    deleted_entitlements AS (
      DELETE FROM entitlements_cache ec
      WHERE ec.status IN ('expired', 'canceled')
        AND ec.updated_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
      RETURNING 1
    )
    SELECT
      (SELECT COUNT(*) FROM deleted_characters) AS soft_deleted_characters,
      (SELECT COUNT(*) FROM deleted_proxy_messages) AS stale_proxy_messages,
      (SELECT COUNT(*) FROM deleted_channel_modes) AS stale_channel_modes,
      (SELECT COUNT(*) FROM deleted_gifted_guilds) AS expired_gifted_guilds,
      (SELECT COUNT(*) FROM deleted_entitlements) AS stale_entitlements
  `);
  const row = result.rows[0];

  if (!row) return [];

  return [
    {
      category: 'soft-deleted-characters',
      label: labelForCategory('soft-deleted-characters'),
      count: toCount(row.soft_deleted_characters),
    },
    {
      category: 'stale-proxy-messages',
      label: labelForCategory('stale-proxy-messages'),
      count: toCount(row.stale_proxy_messages),
    },
    {
      category: 'stale-channel-modes',
      label: labelForCategory('stale-channel-modes'),
      count: toCount(row.stale_channel_modes),
    },
    {
      category: 'expired-gifted-guilds',
      label: labelForCategory('expired-gifted-guilds'),
      count: toCount(row.expired_gifted_guilds),
    },
    {
      category: 'stale-entitlements',
      label: labelForCategory('stale-entitlements'),
      count: toCount(row.stale_entitlements),
    },
  ];
}

export async function getGlobalStats(client: QueryClient = DEFAULT_CLIENT): Promise<GlobalStats> {
  const result = await client.query<{
    active_subscriber_guilds: string | number;
    active_gifted_guilds: string | number;
    active_access_guilds: string | number;
    public_games: string | number;
    total_games: string | number;
    public_characters: string | number;
    total_active_characters: string | number;
    linked_players: string | number;
  }>(`
    SELECT
      (
        SELECT COUNT(DISTINCT guild_id)
        FROM entitlements_cache
        WHERE status = 'active'
          AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP)
      ) AS active_subscriber_guilds,
      (
        SELECT COUNT(*)
        FROM gifted_guilds
        WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP
      ) AS active_gifted_guilds,
      (
        SELECT COUNT(*)
        FROM (
          SELECT guild_id
          FROM entitlements_cache
          WHERE status = 'active'
            AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP)
          UNION
          SELECT guild_id
          FROM gifted_guilds
          WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP
        ) active_access_guilds
      ) AS active_access_guilds,
      (
        SELECT COUNT(*)
        FROM game
        WHERE is_public = TRUE
      ) AS public_games,
      (
        SELECT COUNT(*)
        FROM game
      ) AS total_games,
      (
        SELECT COUNT(*)
        FROM character
        WHERE visibility = 'public'
          AND deleted_at IS NULL
      ) AS public_characters,
      (
        SELECT COUNT(*)
        FROM character
        WHERE deleted_at IS NULL
      ) AS total_active_characters,
      (
        SELECT COUNT(DISTINCT p.discord_id)
        FROM player p
      ) AS linked_players
  `);

  const row = result.rows[0];

  return {
    activeSubscriberGuilds: toCount(row?.active_subscriber_guilds),
    activeGiftedGuilds: toCount(row?.active_gifted_guilds),
    activeAccessGuilds: toCount(row?.active_access_guilds),
    publicGames: toCount(row?.public_games),
    totalGames: toCount(row?.total_games),
    publicCharacters: toCount(row?.public_characters),
    totalActiveCharacters: toCount(row?.total_active_characters),
    linkedPlayers: toCount(row?.linked_players),
  };
}

export async function getThreadBumpCheckCandidates(
  limit = 25,
  client: QueryClient = DEFAULT_CLIENT,
): Promise<ThreadBumpCheckCandidate[]> {
  const result = await client.query<{
    thread_id: string;
    guild_id: string;
    updated_at: string;
  }>(
    `
      SELECT thread_id, guild_id, updated_at::text AS updated_at
      FROM thread_bumps
      ORDER BY updated_at ASC
      LIMIT $1
    `,
    [limit],
  );

  return result.rows.map((row) => ({
    threadId: row.thread_id,
    guildId: row.guild_id,
    detail: `updated ${row.updated_at}`,
  }));
}

export async function getGameAudit(
  guildId: string,
  client: QueryClient = DEFAULT_CLIENT,
): Promise<GameAuditRow[]> {
  const result = await client.query<{
    id: string;
    name: string;
    created_by: string;
    is_public: boolean;
    created_at: string;
    stat_template_count: string | number;
    character_count: string | number;
    public_character_count: string | number;
    private_character_count: string | number;
    last_activity_at: string;
    inactive_over_60_days: boolean;
  }>(
    `
      SELECT g.id::text AS id,
             g.name,
             g.created_by,
             g.is_public,
             g.created_at::text AS created_at,
             COUNT(DISTINCT st.id) AS stat_template_count,
             COUNT(DISTINCT c.id) FILTER (WHERE c.deleted_at IS NULL) AS character_count,
             COUNT(DISTINCT c.id) FILTER (
               WHERE c.deleted_at IS NULL AND c.visibility = 'public'
             ) AS public_character_count,
             COUNT(DISTINCT c.id) FILTER (
               WHERE c.deleted_at IS NULL AND c.visibility = 'private'
             ) AS private_character_count,
             COALESCE(MAX(c.last_updated_at), g.updated_at)::text AS last_activity_at,
             COALESCE(MAX(c.last_updated_at), g.updated_at) < CURRENT_TIMESTAMP - INTERVAL '60 days'
               AS inactive_over_60_days
      FROM game g
      LEFT JOIN stat_template st ON st.game_id = g.id
      LEFT JOIN character c ON c.game_id = g.id
      WHERE g.guild_id = $1
      GROUP BY g.id, g.name, g.created_by, g.is_public, g.created_at, g.updated_at
      ORDER BY g.created_at DESC
    `,
    [guildId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    isPublic: row.is_public,
    createdAt: row.created_at,
    statTemplateCount: toCount(row.stat_template_count),
    characterCount: toCount(row.character_count),
    publicCharacterCount: toCount(row.public_character_count),
    privateCharacterCount: toCount(row.private_character_count),
    lastActivityAt: row.last_activity_at,
    inactiveOver60Days: row.inactive_over_60_days,
  }));
}

export async function getPrivateCharacterAudit(
  {
    guildId,
    gameId,
  }: {
    guildId: string;
    gameId?: string | null;
  },
  client: QueryClient = DEFAULT_CLIENT,
): Promise<PrivateCharacterAuditRow[]> {
  const params: string[] = [guildId];
  const gameFilter = gameId ? 'AND g.id = $2' : '';
  if (gameId) params.push(gameId);

  const result = await client.query<{
    id: string;
    name: string;
    game_id: string;
    game_name: string;
    owner_id: string;
    created_at: string;
    filled_stat_count: string | number;
    total_stat_count: string | number;
  }>(
    `
      SELECT c.id::text AS id,
             c.name,
             c.game_id::text AS game_id,
             g.name AS game_name,
             c.user_id AS owner_id,
             c.created_at::text AS created_at,
             COUNT(csf.id) FILTER (WHERE COALESCE(csf.value, '') <> '') AS filled_stat_count,
             COUNT(csf.id) AS total_stat_count
      FROM character c
      JOIN game g ON g.id = c.game_id
      LEFT JOIN character_stat_field csf ON csf.character_id = c.id
      WHERE g.guild_id = $1
        ${gameFilter}
        AND c.visibility = 'private'
        AND c.deleted_at IS NULL
      GROUP BY c.id, c.name, c.game_id, g.name, c.user_id, c.created_at
      ORDER BY g.name ASC, c.created_at ASC
    `,
    params,
  );

  return result.rows.map((row) => {
    const filledStatCount = toCount(row.filled_stat_count);
    const totalStatCount = toCount(row.total_stat_count);
    return {
      id: row.id,
      name: row.name,
      gameId: row.game_id,
      gameName: row.game_name,
      ownerId: row.owner_id,
      createdAt: row.created_at,
      filledStatCount,
      totalStatCount,
      hasNoFilledStats: filledStatCount === 0,
    };
  });
}

export async function userOwnsGameInGuild(
  userId: string,
  guildId: string,
  client: QueryClient = DEFAULT_CLIENT,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1 FROM game
        WHERE guild_id = $1 AND created_by = $2
      ) AS exists
    `,
    [guildId, userId],
  );

  return result.rows[0]?.exists ?? false;
}

export async function userOwnsGame(
  userId: string,
  gameId: string,
  guildId: string,
  client: QueryClient = DEFAULT_CLIENT,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1 FROM game
        WHERE id = $1 AND guild_id = $2 AND created_by = $3
      ) AS exists
    `,
    [gameId, guildId, userId],
  );

  return result.rows[0]?.exists ?? false;
}
