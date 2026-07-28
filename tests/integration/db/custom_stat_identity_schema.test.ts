import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { executeSqlScript, query } from '../../../src/db/client';

const migration = readFileSync(
  join(process.cwd(), 'src/db/tables/012_custom_stat_identity_presets.sql'),
  'utf8',
);

describe('custom-stat identity migration', () => {
  test('backfills deterministic valid collision-safe keys without changing rows or values', async () => {
    const game = await query<{ id: string }>(
      `INSERT INTO game (guild_id, name, created_by)
       VALUES ('guild-1', 'Legacy', 'gm-1')
       RETURNING id`,
    );
    const gameId = game.rows[0]!.id;

    await query('ALTER TABLE stat_template DROP COLUMN stat_key CASCADE');
    await query(
      `INSERT INTO stat_template (game_id, label, field_type, default_value, sort_order)
       VALUES
         ($1, 'HP', 'count', '12', 0),
         ($1, 'hp', 'count', '8', 1),
         ($1, '123 Stress!', 'number', '0', 2)`,
      [gameId],
    );
    const hpTemplate = await query<{ id: string }>(
      `SELECT id FROM stat_template WHERE game_id = $1 AND label = 'HP'`,
      [gameId],
    );
    const character = await query<{ id: string }>(
      `INSERT INTO character (game_id, user_id, name)
       VALUES ($1, 'player-1', 'Legacy Hero')
       RETURNING id`,
      [gameId],
    );
    const entity = await query<{ id: string }>(
      `INSERT INTO game_entity (game_id, created_by, kind, name)
       VALUES ($1, 'gm-1', 'npc', 'Legacy NPC')
       RETURNING id`,
      [gameId],
    );
    await query(
      `INSERT INTO character_stat_field (character_id, template_id, value, meta)
       VALUES ($1, $2, '7', '{"current": 7, "max": 12}')`,
      [character.rows[0]!.id, hpTemplate.rows[0]!.id],
    );
    await query(
      `INSERT INTO game_entity_stat_field (game_entity_id, template_id, value, meta)
       VALUES ($1, $2, '5', '{"current": 5, "max": 12}')`,
      [entity.rows[0]!.id, hpTemplate.rows[0]!.id],
    );

    await executeSqlScript(migration);
    await executeSqlScript(migration);

    const templates = await query<{
      label: string;
      stat_key: string;
      default_value: string | null;
    }>(
      `SELECT label, stat_key, default_value
       FROM stat_template
       WHERE game_id = $1
       ORDER BY sort_order`,
      [gameId],
    );
    expect(templates.rows).toEqual([
      { label: 'HP', stat_key: 'hp', default_value: '12' },
      { label: 'hp', stat_key: 'hp_2', default_value: '8' },
      { label: '123 Stress!', stat_key: 'stat_123_stress', default_value: '0' },
    ]);
    await expect(
      query<{ value: string; meta: { current: number; max: number } }>(
        `SELECT value, meta FROM character_stat_field WHERE character_id = $1`,
        [character.rows[0]!.id],
      ),
    ).resolves.toMatchObject({ rows: [{ value: '7', meta: { current: 7, max: 12 } }] });
    await expect(
      query<{ value: string; meta: { current: number; max: number } }>(
        `SELECT value, meta FROM game_entity_stat_field WHERE game_entity_id = $1`,
        [entity.rows[0]!.id],
      ),
    ).resolves.toMatchObject({ rows: [{ value: '5', meta: { current: 5, max: 12 } }] });
  });

  test('enforces key format, case-insensitive uniqueness, and immutability', async () => {
    const game = await query<{ id: string }>(
      `INSERT INTO game (guild_id, name, created_by)
       VALUES ('guild-1', 'Rules', 'gm-1')
       RETURNING id`,
    );
    const gameId = game.rows[0]!.id;
    const template = await query<{ id: string }>(
      `INSERT INTO stat_template (game_id, stat_key, label)
       VALUES ($1, 'stress', 'Stress')
       RETURNING id`,
      [gameId],
    );

    await expect(
      query(`INSERT INTO stat_template (game_id, stat_key, label) VALUES ($1, 'Stress', 'Bad')`, [
        gameId,
      ]),
    ).rejects.toThrow();
    await expect(
      query(`INSERT INTO stat_template (game_id, stat_key, label) VALUES ($1, 'STRESS', 'Copy')`, [
        gameId,
      ]),
    ).rejects.toThrow();
    await expect(
      query(`UPDATE stat_template SET stat_key = 'pressure' WHERE id = $1`, [template.rows[0]!.id]),
    ).rejects.toThrow('immutable');
  });
});
