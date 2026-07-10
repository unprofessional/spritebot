import { CharacterDAO } from '../../../src/dao/character.dao';
import { CharacterStatFieldDAO } from '../../../src/dao/character_stat_field.dao';
import { GameDAO } from '../../../src/dao/game.dao';
import { StatTemplateDAO } from '../../../src/dao/stat_template.dao';
import { query } from '../../../src/db/client';
import {
  getGameAudit,
  getOrphanReport,
  getPrivateCharacterAudit,
  purgeSafeOrphans,
  userOwnsGame,
  userOwnsGameInGuild,
} from '../../../src/services/admin_housekeeping.service';

describe('admin_housekeeping.service', () => {
  const gameDAO = new GameDAO();
  const characterDAO = new CharacterDAO();
  const statTemplateDAO = new StatTemplateDAO();
  const statFieldDAO = new CharacterStatFieldDAO();

  async function createGame(name: string, overrides: { isPublic?: boolean } = {}) {
    const game = await gameDAO.create({
      name,
      description: '',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });

    if (overrides.isPublic) {
      return (await gameDAO.togglePublish(game.id)) ?? game;
    }

    return game;
  }

  test('detects stale orphan categories without touching integration tables', async () => {
    const abandonedGame = await createGame('Forgotten Draft');
    await query(
      `UPDATE game SET created_at = CURRENT_TIMESTAMP - INTERVAL '8 days' WHERE id = $1`,
      [abandonedGame.id],
    );

    const emptyPublishedGame = await createGame('Empty Public Table', { isPublic: true });
    await query(
      `UPDATE game SET created_at = CURRENT_TIMESTAMP - INTERVAL '31 days' WHERE id = $1`,
      [emptyPublishedGame.id],
    );

    const characterGame = await createGame('Deleted Character Game');
    const character = await characterDAO.create({
      user_id: 'player-1',
      game_id: characterGame.id,
      name: 'Faded Hero',
    });
    await query(
      `UPDATE character SET deleted_at = CURRENT_TIMESTAMP - INTERVAL '31 days' WHERE id = $1`,
      [character.id],
    );

    await query(
      `
        INSERT INTO rp_proxy_message (
          proxy_message_id, guild_id, channel_id, user_id, webhook_id, created_at
        )
        VALUES (
          'proxy-1', 'guild-1', 'channel-1', 'player-1', 'webhook-1',
          CURRENT_TIMESTAMP - INTERVAL '91 days'
        )
      `,
    );
    await query(
      `
        INSERT INTO rp_channel_mode (guild_id, channel_id, user_id, is_ic, updated_at)
        VALUES (
          'guild-1', 'channel-1', 'player-1', true,
          CURRENT_TIMESTAMP - INTERVAL '91 days'
        )
      `,
    );
    await query(
      `
        INSERT INTO gifted_guilds (guild_id, granted_by, expires_at)
        VALUES ('expired-guild', 'owner-1', CURRENT_TIMESTAMP - INTERVAL '1 day')
      `,
    );
    await query(
      `
        INSERT INTO entitlements_cache (
          entitlement_id, guild_id, sku_id, status, starts_at, updated_at
        )
        VALUES (
          'entitlement-1', 'guild-1', 'sku-1', 'expired',
          CURRENT_TIMESTAMP - INTERVAL '120 days',
          CURRENT_TIMESTAMP - INTERVAL '91 days'
        )
      `,
    );

    const report = await getOrphanReport();
    const counts = Object.fromEntries(
      report.map((category) => [category.category, category.count]),
    );

    expect(counts).toEqual(
      expect.objectContaining({
        'abandoned-games': 1,
        'empty-published-games': 1,
        'soft-deleted-characters': 1,
        'stale-proxy-messages': 1,
        'stale-channel-modes': 1,
        'expired-gifted-guilds': 1,
        'stale-entitlements': 1,
      }),
    );

    expect(report.find((category) => category.category === 'abandoned-games')?.examples[0]).toEqual(
      expect.objectContaining({
        id: abandonedGame.id,
        name: 'Forgotten Draft',
      }),
    );
  });

  test('purges only safe orphan categories and leaves manual-review data alone', async () => {
    const abandonedGame = await createGame('Manual Review Draft');
    await query(
      `UPDATE game SET created_at = CURRENT_TIMESTAMP - INTERVAL '8 days' WHERE id = $1`,
      [abandonedGame.id],
    );

    const emptyPublishedGame = await createGame('Manual Review Public Table', { isPublic: true });
    await query(
      `UPDATE game SET created_at = CURRENT_TIMESTAMP - INTERVAL '31 days' WHERE id = $1`,
      [emptyPublishedGame.id],
    );

    const softDeletedGame = await createGame('Soft Deleted Character Game');
    const oldDeletedCharacter = await characterDAO.create({
      user_id: 'player-1',
      game_id: softDeletedGame.id,
      name: 'Gone Hero',
    });
    await query(
      `UPDATE character SET deleted_at = CURRENT_TIMESTAMP - INTERVAL '31 days' WHERE id = $1`,
      [oldDeletedCharacter.id],
    );

    const recentlyDeletedCharacter = await characterDAO.create({
      user_id: 'player-2',
      game_id: softDeletedGame.id,
      name: 'Recoverable Hero',
    });
    await query(
      `UPDATE character SET deleted_at = CURRENT_TIMESTAMP - INTERVAL '7 days' WHERE id = $1`,
      [recentlyDeletedCharacter.id],
    );

    await query(
      `
        INSERT INTO rp_proxy_message (
          proxy_message_id, guild_id, channel_id, user_id, webhook_id, created_at
        )
        VALUES (
          'stale-proxy', 'guild-1', 'channel-1', 'player-1', 'webhook-1',
          CURRENT_TIMESTAMP - INTERVAL '91 days'
        ),
        (
          'fresh-proxy', 'guild-1', 'channel-1', 'player-1', 'webhook-1',
          CURRENT_TIMESTAMP - INTERVAL '7 days'
        )
      `,
    );
    await query(
      `
        INSERT INTO rp_channel_mode (guild_id, channel_id, user_id, is_ic, updated_at)
        VALUES (
          'guild-1', 'stale-channel', 'player-1', true,
          CURRENT_TIMESTAMP - INTERVAL '91 days'
        ),
        (
          'guild-1', 'fresh-channel', 'player-1', true,
          CURRENT_TIMESTAMP - INTERVAL '7 days'
        )
      `,
    );
    await query(
      `
        INSERT INTO gifted_guilds (guild_id, granted_by, expires_at)
        VALUES
          ('expired-guild', 'owner-1', CURRENT_TIMESTAMP - INTERVAL '1 day'),
          ('fresh-guild', 'owner-1', CURRENT_TIMESTAMP + INTERVAL '7 days')
      `,
    );
    await query(
      `
        INSERT INTO entitlements_cache (
          entitlement_id, guild_id, sku_id, status, starts_at, updated_at
        )
        VALUES
          (
            'stale-entitlement', 'guild-1', 'sku-1', 'expired',
            CURRENT_TIMESTAMP - INTERVAL '120 days',
            CURRENT_TIMESTAMP - INTERVAL '91 days'
          ),
          (
            'fresh-entitlement', 'guild-1', 'sku-1', 'active',
            CURRENT_TIMESTAMP - INTERVAL '7 days',
            CURRENT_TIMESTAMP - INTERVAL '7 days'
          )
      `,
    );

    const results = await purgeSafeOrphans();
    const counts = Object.fromEntries(results.map((result) => [result.category, result.count]));

    expect(counts).toEqual({
      'soft-deleted-characters': 1,
      'stale-proxy-messages': 1,
      'stale-channel-modes': 1,
      'expired-gifted-guilds': 1,
      'stale-entitlements': 1,
    });

    await expect(
      query<{ count: string | number }>(`SELECT COUNT(*) AS count FROM game WHERE id IN ($1, $2)`, [
        abandonedGame.id,
        emptyPublishedGame.id,
      ]),
    ).resolves.toMatchObject({ rows: [{ count: 2 }] });
    await expect(
      query<{ count: string | number }>(`SELECT COUNT(*) AS count FROM character WHERE id = $1`, [
        recentlyDeletedCharacter.id,
      ]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      query<{ count: string | number }>(
        `
          SELECT COUNT(*) AS count
          FROM rp_proxy_message
          WHERE proxy_message_id = 'fresh-proxy'
        `,
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      query<{ count: string | number }>(
        `
          SELECT COUNT(*) AS count
          FROM rp_proxy_message
          WHERE proxy_message_id = 'stale-proxy'
        `,
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  test('audits games in a guild with activity and visibility counts', async () => {
    const game = await createGame('Busy Table', { isPublic: true });
    await statTemplateDAO.create({
      game_id: game.id,
      label: 'HP',
      field_type: 'number',
    });
    await characterDAO.create({
      user_id: 'player-1',
      game_id: game.id,
      name: 'Visible Hero',
      visibility: 'public',
    });
    await characterDAO.create({
      user_id: 'player-2',
      game_id: game.id,
      name: 'Quiet Hero',
      visibility: 'private',
    });

    const rows = await getGameAudit('guild-1');

    expect(rows).toEqual([
      expect.objectContaining({
        id: game.id,
        name: 'Busy Table',
        createdBy: 'gm-1',
        isPublic: true,
        statTemplateCount: 1,
        characterCount: 2,
        publicCharacterCount: 1,
        privateCharacterCount: 1,
        inactiveOver60Days: false,
      }),
    ]);
  });

  test('audits private characters and ownership scope', async () => {
    const game = await createGame('Private Table');
    const template = await statTemplateDAO.create({
      game_id: game.id,
      label: 'HP',
      field_type: 'number',
    });
    const filled = await characterDAO.create({
      user_id: 'player-1',
      game_id: game.id,
      name: 'Private Hero',
      visibility: 'private',
    });
    await statFieldDAO.create(filled.id, template.id, '12');

    await characterDAO.create({
      user_id: 'player-2',
      game_id: game.id,
      name: 'Draft Hero',
      visibility: 'private',
    });

    await expect(
      getPrivateCharacterAudit({ guildId: 'guild-1', gameId: game.id }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Private Hero',
          ownerId: 'player-1',
          filledStatCount: 1,
          totalStatCount: 1,
          hasNoFilledStats: false,
        }),
        expect.objectContaining({
          name: 'Draft Hero',
          ownerId: 'player-2',
          filledStatCount: 0,
          totalStatCount: 0,
          hasNoFilledStats: true,
        }),
      ]),
    );

    await expect(userOwnsGameInGuild('gm-1', 'guild-1')).resolves.toBe(true);
    await expect(userOwnsGame('gm-1', game.id, 'guild-1')).resolves.toBe(true);
    await expect(userOwnsGame('player-1', game.id, 'guild-1')).resolves.toBe(false);
  });
});
