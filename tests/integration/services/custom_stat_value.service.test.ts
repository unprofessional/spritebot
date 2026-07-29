import { query } from '../../../src/db/client';
import {
  applyCustomStatValue,
  getCustomStatValueState,
} from '../../../src/services/custom_stat_value.service';
import type { ApplyCustomStatValueInput } from '../../../src/types/custom_stat_value';

async function createFixture(fieldType: 'number' | 'count' = 'number') {
  const game = await query<{ id: string }>(
    `INSERT INTO game (guild_id, name, created_by)
     VALUES ($1, 'Provenance', 'gm-1')
     RETURNING id`,
    [`guild-${Math.random()}`],
  );
  const gameId = game.rows[0]!.id;
  const template = await query<{ id: string }>(
    `INSERT INTO stat_template (
       game_id, stat_key, label, field_type, default_value, is_required, sort_order, meta
     )
     VALUES ($1, 'stress', 'Stress', $2, $3, true, 0, $4)
     RETURNING id`,
    [
      gameId,
      fieldType,
      fieldType === 'count' ? '10' : '0',
      fieldType === 'count' ? JSON.stringify({ default_current: 10 }) : '{}',
    ],
  );
  const character = await query<{ id: string }>(
    `INSERT INTO character (game_id, user_id, name)
     VALUES ($1, 'player-1', 'Hero')
     RETURNING id`,
    [gameId],
  );
  const entity = await query<{ id: string }>(
    `INSERT INTO game_entity (game_id, created_by, kind, name)
     VALUES ($1, 'gm-1', 'creature', 'Monster')
     RETURNING id`,
    [gameId],
  );

  return {
    gameId,
    templateId: template.rows[0]!.id,
    characterId: character.rows[0]!.id,
    entityId: entity.rows[0]!.id,
  };
}

function input(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  overrides: Partial<ApplyCustomStatValueInput> = {},
): ApplyCustomStatValueInput {
  return {
    gameId: fixture.gameId,
    targetType: 'character',
    targetId: fixture.characterId,
    templateId: fixture.templateId,
    value: '3',
    meta: {},
    integrationKey: 'talespire',
    campaignId: 'campaign-1',
    sourceStatKey: 'stat:stress',
    sourceObservedAt: '2026-07-28T20:00:00.000Z',
    sourceRevision: 'revision-1',
    mappingId: 'mapping-1',
    mappingVersion: 'version-1',
    writer: 'spritebot-integrations',
    ...overrides,
  };
}

async function provenanceCount(): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM custom_stat_value_provenance`,
  );
  return Number(result.rows[0]!.count);
}

describe('custom stat atomic value and provenance contract', () => {
  test.each([
    ['character', 'characterId', 'character_stat_field', 'character_id'],
    ['entity', 'entityId', 'game_entity_stat_field', 'game_entity_id'],
  ] as const)(
    'writes and reads an attributable %s value with provenance',
    async (targetType, idKey, table, idColumn) => {
      const fixture = await createFixture();
      const targetId = fixture[idKey];
      const result = await applyCustomStatValue(
        input(fixture, { targetType, targetId, actorDiscordUserId: 'gm-1' }),
      );

      expect(result).toMatchObject({
        outcome: 'written',
        priorValue: { value: null, meta: {} },
        newValue: { value: '3', meta: {} },
        provenanceId: expect.any(String),
      });
      await expect(
        query<{ value: string }>(
          `SELECT value FROM ${table} WHERE ${idColumn} = $1 AND template_id = $2`,
          [targetId, fixture.templateId],
        ),
      ).resolves.toMatchObject({ rows: [{ value: '3' }] });
      await expect(
        getCustomStatValueState({
          gameId: fixture.gameId,
          targetType,
          targetId,
          templateId: fixture.templateId,
        }),
      ).resolves.toMatchObject({
        value: '3',
        provenance: {
          integration_key: 'talespire',
          campaign_id: 'campaign-1',
          source_stat_key: 'stat:stress',
          actor_discord_user_id: 'gm-1',
        },
      });
    },
  );

  test('treats an exact replay as unchanged without duplicating provenance', async () => {
    const fixture = await createFixture();
    const request = input(fixture);
    const first = await applyCustomStatValue(request);
    const replay = await applyCustomStatValue(request);

    expect(first.outcome).toBe('written');
    expect(replay).toMatchObject({
      outcome: 'unchanged',
      provenanceId: first.provenanceId,
    });
    expect(await provenanceCount()).toBe(1);
  });

  test('rejects an older observation and a changed value at the same revision', async () => {
    const fixture = await createFixture();
    await applyCustomStatValue(input(fixture));

    await expect(
      applyCustomStatValue(
        input(fixture, {
          value: '2',
          sourceRevision: 'revision-old',
          sourceObservedAt: '2026-07-28T19:59:59.000Z',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'stale' });
    await expect(applyCustomStatValue(input(fixture, { value: '4' }))).resolves.toMatchObject({
      outcome: 'conflict',
    });
    expect(await provenanceCount()).toBe(1);
  });

  test('checkpoints a newer unchanged observation so an intermediate older value stays stale', async () => {
    const fixture = await createFixture();
    await applyCustomStatValue(input(fixture));
    await expect(
      applyCustomStatValue(
        input(fixture, {
          sourceObservedAt: '2026-07-28T20:02:00.000Z',
          sourceRevision: 'revision-2',
        }),
      ),
    ).resolves.toMatchObject({
      outcome: 'unchanged',
      provenanceId: expect.any(String),
    });

    await expect(
      applyCustomStatValue(
        input(fixture, {
          value: '4',
          sourceObservedAt: '2026-07-28T20:01:00.000Z',
          sourceRevision: 'revision-intermediate',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'stale' });
    expect(await provenanceCount()).toBe(2);
  });

  test('reevaluates a replay when the mapping version changes', async () => {
    const fixture = await createFixture();
    await applyCustomStatValue(input(fixture));

    await expect(
      applyCustomStatValue(
        input(fixture, {
          value: '4',
          mappingVersion: 'version-2',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'written' });
    expect(await provenanceCount()).toBe(2);
  });

  test('merges count components and preserves provenance for either target type', async () => {
    const fixture = await createFixture('count');

    await expect(
      applyCustomStatValue(
        input(fixture, {
          value: null,
          meta: { current: 7 },
        }),
      ),
    ).resolves.toMatchObject({
      outcome: 'written',
      newValue: { meta: { current: 7 } },
    });
    await expect(
      applyCustomStatValue(
        input(fixture, {
          value: null,
          meta: { max: 12 },
          sourceObservedAt: '2026-07-28T20:01:00.000Z',
          sourceRevision: 'revision-2',
        }),
      ),
    ).resolves.toMatchObject({
      outcome: 'written',
      newValue: { meta: { current: 7, max: 12 } },
    });
  });

  test('fails closed without a canonical write or provenance for invalid values', async () => {
    const fixture = await createFixture();

    await expect(
      applyCustomStatValue(input(fixture, { value: 'not-a-number' })),
    ).resolves.toMatchObject({ outcome: 'invalid', provenanceId: null });
    expect(await provenanceCount()).toBe(0);
    await expect(
      query(`SELECT * FROM character_stat_field WHERE character_id = $1`, [fixture.characterId]),
    ).resolves.toMatchObject({ rows: [] });
  });

  test('rejects deleted, foreign-game, and mismatched targets', async () => {
    const fixture = await createFixture();
    const other = await createFixture();

    await expect(
      applyCustomStatValue(
        input(fixture, {
          gameId: other.gameId,
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'target_missing' });

    await query(`UPDATE character SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [
      fixture.characterId,
    ]);
    await expect(applyCustomStatValue(input(fixture))).resolves.toMatchObject({
      outcome: 'target_missing',
    });
    expect(await provenanceCount()).toBe(0);
  });
});
