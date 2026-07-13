import { query } from '../../../src/db/client';
import {
  getSupportVerificationEligibility,
  verifySupportMember,
} from '../../../src/services/support_verification.service';

describe('support_verification.service', () => {
  beforeEach(() => {
    process.env.SUPPORT_GUILD_ID = 'support-guild';
    process.env.SUBSCRIBER_ROLE_ID = 'subscriber-role';
    process.env.PLAYER_ROLE_ID = 'player-role';
  });

  afterEach(() => {
    delete process.env.SUPPORT_GUILD_ID;
    delete process.env.SUBSCRIBER_ROLE_ID;
    delete process.env.PLAYER_ROLE_ID;
  });

  test('finds subscriber status from active entitlement owner snapshots', async () => {
    await insertEntitlement({
      entitlementId: 'entitlement-1',
      guildId: 'subscribed-guild',
      raw: { user_id: 'user-1' },
    });

    await insertEntitlement({
      entitlementId: 'expired-entitlement',
      guildId: 'expired-guild',
      status: 'expired',
      raw: { user_id: 'user-1' },
    });

    await expect(getSupportVerificationEligibility('user-1')).resolves.toEqual({
      subscriberGuildIds: ['subscribed-guild'],
      playerGuilds: [],
    });
  });

  test('finds subscriber status from active gifted guild recipients', async () => {
    await insertGiftedGuild({
      guildId: 'gifted-guild',
      recipientMemberId: 'user-1',
    });

    await insertGiftedGuild({
      guildId: 'expired-gifted-guild',
      recipientMemberId: 'user-1',
      expiresAt: "CURRENT_TIMESTAMP - INTERVAL '1 day'",
    });

    await expect(getSupportVerificationEligibility('user-1')).resolves.toEqual({
      subscriberGuildIds: ['gifted-guild'],
      playerGuilds: [],
    });
  });

  test('finds player status for current games in entitled guilds', async () => {
    const gameId = await insertGame({ guildId: 'subscribed-guild', createdBy: 'gm-1' });
    await insertPlayerLink({ discordId: 'user-1', guildId: 'subscribed-guild', gameId });
    await insertEntitlement({ entitlementId: 'entitlement-1', guildId: 'subscribed-guild' });

    const freeGameId = await insertGame({ guildId: 'free-guild', createdBy: 'gm-2' });
    await insertPlayerLink({ discordId: 'user-1', guildId: 'free-guild', gameId: freeGameId });

    await expect(getSupportVerificationEligibility('user-1')).resolves.toEqual({
      subscriberGuildIds: [],
      playerGuilds: [{ guild_id: 'subscribed-guild', game_name: 'Lanternfall' }],
    });
  });

  test('finds player status for current games in gifted guilds', async () => {
    const gameId = await insertGame({ guildId: 'gifted-guild', createdBy: 'gm-1' });
    await insertPlayerLink({ discordId: 'user-1', guildId: 'gifted-guild', gameId });
    await insertGiftedGuild({ guildId: 'gifted-guild' });

    await expect(getSupportVerificationEligibility('user-1')).resolves.toEqual({
      subscriberGuildIds: [],
      playerGuilds: [{ guild_id: 'gifted-guild', game_name: 'Lanternfall' }],
    });
  });

  test('does not find gifted guild player status for another user', async () => {
    const gameId = await insertGame({ guildId: 'gifted-guild', createdBy: 'gm-1' });
    await insertPlayerLink({ discordId: 'other-user', guildId: 'gifted-guild', gameId });
    await insertGiftedGuild({ guildId: 'gifted-guild' });

    await expect(getSupportVerificationEligibility('user-1')).resolves.toEqual({
      subscriberGuildIds: [],
      playerGuilds: [],
    });
  });

  test('assigns matching support roles once', async () => {
    const gameId = await insertGame({ guildId: 'subscribed-guild', createdBy: 'gm-1' });
    await insertPlayerLink({ discordId: 'user-1', guildId: 'subscribed-guild', gameId });
    await insertEntitlement({
      entitlementId: 'entitlement-1',
      guildId: 'subscribed-guild',
      raw: { userId: 'user-1' },
    });

    const member = createMember('user-1');

    await expect(verifySupportMember(member)).resolves.toEqual({
      subscriberGuildIds: ['subscribed-guild'],
      playerGuilds: [{ guild_id: 'subscribed-guild', game_name: 'Lanternfall' }],
      assignedRoleIds: ['subscriber-role', 'player-role'],
      missingRoleIds: [],
    });
    expect(member.roles.add).toHaveBeenCalledWith(
      ['subscriber-role', 'player-role'],
      'SPRITEbot support server verification',
    );
  });

  test('does not assign roles when the user has no verification match', async () => {
    const member = createMember('unknown-user');

    await expect(verifySupportMember(member)).resolves.toEqual({
      subscriberGuildIds: [],
      playerGuilds: [],
      assignedRoleIds: [],
      missingRoleIds: [],
    });
    expect(member.roles.add).not.toHaveBeenCalled();
  });
});

async function insertEntitlement({
  entitlementId,
  guildId,
  status = 'active',
  raw = {},
}: {
  entitlementId: string;
  guildId: string;
  status?: 'active' | 'expired' | 'canceled';
  raw?: Record<string, unknown>;
}) {
  await query(
    `
      INSERT INTO entitlements_cache (entitlement_id, guild_id, sku_id, status, starts_at, raw)
      VALUES ($1, $2, 'sku-1', $3, CURRENT_TIMESTAMP, $4::jsonb)
    `,
    [entitlementId, guildId, status, JSON.stringify(raw)],
  );
}

async function insertGame({
  guildId,
  createdBy,
}: {
  guildId: string;
  createdBy: string;
}): Promise<string> {
  const result = await query<{ id: string }>(
    `
      INSERT INTO game (guild_id, name, created_by, is_public)
      VALUES ($1, 'Lanternfall', $2, true)
      RETURNING id
    `,
    [guildId, createdBy],
  );

  return result.rows[0].id;
}

async function insertGiftedGuild({
  guildId,
  recipientMemberId = null,
  expiresAt = null,
}: {
  guildId: string;
  recipientMemberId?: string | null;
  expiresAt?: string | null;
}) {
  await query(
    `
      INSERT INTO gifted_guilds (guild_id, granted_by, recipient_member_id, expires_at)
      VALUES ($1, 'owner-1', $2, ${expiresAt ?? 'NULL'})
    `,
    [guildId, recipientMemberId],
  );
}

async function insertPlayerLink({
  discordId,
  guildId,
  gameId,
}: {
  discordId: string;
  guildId: string;
  gameId: string;
}) {
  const player = await query<{ id: string }>(
    `
      INSERT INTO player (discord_id)
      VALUES ($1)
      ON CONFLICT (discord_id) DO UPDATE SET discord_id = EXCLUDED.discord_id
      RETURNING id
    `,
    [discordId],
  );

  await query(
    `
      INSERT INTO player_server_link (player_id, guild_id, current_game_id)
      VALUES ($1, $2, $3)
    `,
    [player.rows[0].id, guildId, gameId],
  );
}

function createMember(userId: string): any {
  return {
    guild: { id: 'support-guild' },
    user: { id: userId },
    roles: {
      cache: new Map<string, unknown>(),
      add: jest.fn().mockResolvedValue(undefined),
    },
  };
}
