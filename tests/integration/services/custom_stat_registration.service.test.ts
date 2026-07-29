import { query } from '../../../src/db/client';
import {
  listCustomStatDefinitions,
  registerCustomStatDefinition,
} from '../../../src/services/custom_stat_registration.service';
import type { RegisterCustomStatDefinitionParams } from '../../../src/types/stat_template';

async function createGame(name: string, deleted = false): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO game (guild_id, name, created_by, deleted_at)
     VALUES ($1, $2, 'gm-1', $3)
     RETURNING id`,
    [`guild-${name}`, name, deleted ? new Date().toISOString() : null],
  );
  return result.rows[0]!.id;
}

function registration(
  gameId: string,
  overrides: Partial<RegisterCustomStatDefinitionParams> = {},
): RegisterCustomStatDefinitionParams {
  return {
    game_id: gameId,
    stat_key: 'stress',
    label: 'Stress',
    field_type: 'number',
    default_value: '0',
    is_required: true,
    sort_order: 0,
    meta: {},
    actor_discord_user_id: 'gm-1',
    idempotency_key: 'request-1',
    ...overrides,
  };
}

async function auditCount(gameId?: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM custom_stat_registration_audit
     WHERE ($1::uuid IS NULL OR game_id = $1)`,
    [gameId ?? null],
  );
  return Number(result.rows[0]!.count);
}

describe('custom-stat registration contract', () => {
  test('creates a definition and an attributable audit atomically', async () => {
    const gameId = await createGame('create');

    await expect(registerCustomStatDefinition(registration(gameId))).resolves.toMatchObject({
      outcome: 'created',
      id: expect.any(String),
      stat_key: 'stress',
    });

    await expect(
      query<{
        stat_key: string;
        actor_discord_user_id: string;
        idempotency_key: string;
        outcome: string;
        request_fingerprint: string;
      }>(
        `SELECT st.stat_key, audit.actor_discord_user_id, audit.idempotency_key,
                audit.outcome, audit.request_fingerprint
         FROM custom_stat_registration_audit audit
         JOIN stat_template st ON st.id = audit.definition_id
         WHERE audit.game_id = $1`,
        [gameId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          stat_key: 'stress',
          actor_discord_user_id: 'gm-1',
          idempotency_key: 'request-1',
          outcome: 'created',
          request_fingerprint: expect.stringMatching(/^[a-f0-9]{32}$/),
        },
      ],
    });
  });

  test('lists only definitions in an active requested game with deterministic ordering', async () => {
    const gameId = await createGame('listed');
    const otherGameId = await createGame('other');
    const deletedGameId = await createGame('deleted', true);

    await registerCustomStatDefinition(
      registration(gameId, {
        stat_key: 'zeta',
        label: 'Zeta',
        sort_order: 2,
        idempotency_key: 'zeta',
      }),
    );
    await registerCustomStatDefinition(
      registration(gameId, {
        stat_key: 'alpha',
        label: 'Alpha',
        field_type: 'short',
        default_value: null,
        sort_order: 1,
        idempotency_key: 'alpha',
      }),
    );
    await registerCustomStatDefinition(
      registration(otherGameId, {
        stat_key: 'other',
        label: 'Other',
        idempotency_key: 'other',
      }),
    );

    await expect(listCustomStatDefinitions(gameId)).resolves.toMatchObject([
      { game_id: gameId, stat_key: 'alpha' },
      { game_id: gameId, stat_key: 'zeta' },
    ]);
    await expect(listCustomStatDefinitions(otherGameId)).resolves.toMatchObject([
      { game_id: otherGameId, stat_key: 'other' },
    ]);
    await expect(listCustomStatDefinitions(deletedGameId)).resolves.toEqual([]);
    await expect(
      listCustomStatDefinitions('00000000-0000-0000-0000-000000000000'),
    ).resolves.toEqual([]);
  });

  test('replays an equivalent request without duplicating its definition or audit', async () => {
    const gameId = await createGame('replay');
    const input = registration(gameId);
    const created = await registerCustomStatDefinition(input);
    const replayed = await registerCustomStatDefinition(input);

    expect(replayed).toEqual({
      outcome: 'existing_equivalent',
      id: created.id,
      stat_key: 'stress',
    });
    await expect(
      query<{ definitions: string; audits: string }>(
        `SELECT
           (SELECT count(*) FROM stat_template WHERE game_id = $1)::text AS definitions,
           (SELECT count(*) FROM custom_stat_registration_audit WHERE game_id = $1)::text AS audits`,
        [gameId],
      ),
    ).resolves.toMatchObject({ rows: [{ definitions: '1', audits: '1' }] });
  });

  test('rejects a changed payload replay without creating or auditing it', async () => {
    const gameId = await createGame('changed-replay');
    const created = await registerCustomStatDefinition(registration(gameId));

    await expect(
      registerCustomStatDefinition(registration(gameId, { label: 'Changed' })),
    ).resolves.toEqual({
      outcome: 'conflict',
      id: created.id,
      stat_key: 'stress',
    });
    expect(await auditCount(gameId)).toBe(1);
  });

  test('converges equivalent keys from different requests and audits both actions', async () => {
    const gameId = await createGame('convergent');
    const created = await registerCustomStatDefinition(registration(gameId));

    await expect(
      registerCustomStatDefinition(
        registration(gameId, {
          actor_discord_user_id: 'gm-2',
          idempotency_key: 'request-2',
        }),
      ),
    ).resolves.toEqual({
      outcome: 'existing_equivalent',
      id: created.id,
      stat_key: 'stress',
    });
    expect(await auditCount(gameId)).toBe(2);
  });

  test('returns a visible conflict for an incompatible existing key without an audit', async () => {
    const gameId = await createGame('collision');
    const created = await registerCustomStatDefinition(registration(gameId));

    await expect(
      registerCustomStatDefinition(
        registration(gameId, {
          field_type: 'paragraph',
          default_value: null,
          idempotency_key: 'request-2',
        }),
      ),
    ).resolves.toEqual({
      outcome: 'conflict',
      id: created.id,
      stat_key: 'stress',
    });
    expect(await auditCount(gameId)).toBe(1);
  });

  test('scopes the same idempotency key independently per game', async () => {
    const firstGameId = await createGame('scope-1');
    const secondGameId = await createGame('scope-2');

    const first = await registerCustomStatDefinition(registration(firstGameId));
    const second = await registerCustomStatDefinition(registration(secondGameId));

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('created');
    expect(first.id).not.toBe(second.id);
    expect(await auditCount()).toBe(2);
  });

  test.each([
    ['invalid key', { stat_key: 'Stress' }],
    ['invalid field type', { field_type: 'dice' }],
    ['blank label', { label: '   ' }],
    ['blank actor', { actor_discord_user_id: '' }],
    ['blank idempotency key', { idempotency_key: '' }],
    ['invalid number default', { default_value: 'many' }],
    [
      'count without a max for current',
      { field_type: 'count', default_value: null, meta: { default_current: 2 } },
    ],
    [
      'fractional count current',
      { field_type: 'count', default_value: '5', meta: { default_current: 2.5 } },
    ],
    [
      'count metadata on a scalar',
      { field_type: 'short', default_value: null, meta: { default_current: 2 } },
    ],
  ])('returns invalid for %s without creating or auditing', async (_name, overrides) => {
    const gameId = await createGame(`invalid-${_name}`);
    const result = await registerCustomStatDefinition(
      registration(gameId, overrides as Partial<RegisterCustomStatDefinitionParams>),
    );

    expect(result.outcome).toBe('invalid');
    expect(await listCustomStatDefinitions(gameId)).toEqual([]);
    expect(await auditCount(gameId)).toBe(0);
  });

  test('returns target_missing for missing and deleted games without an audit', async () => {
    const deletedGameId = await createGame('missing-target', true);

    await expect(registerCustomStatDefinition(registration(deletedGameId))).resolves.toMatchObject({
      outcome: 'target_missing',
      id: null,
    });
    await expect(
      registerCustomStatDefinition(registration('00000000-0000-0000-0000-000000000000')),
    ).resolves.toMatchObject({
      outcome: 'target_missing',
      id: null,
    });
    expect(await auditCount()).toBe(0);
  });

  test.each([
    ['short', null, {}],
    ['paragraph', 'A longer default', {}],
    ['number', '-2.5', {}],
    ['count', '8', { default_current: 3 }],
  ] as const)('supports the %s Prime field shape', async (fieldType, defaultValue, meta) => {
    const gameId = await createGame(`shape-${fieldType}`);
    const result = await registerCustomStatDefinition(
      registration(gameId, {
        stat_key: `${fieldType}_stat`,
        label: `${fieldType} stat`,
        field_type: fieldType,
        default_value: defaultValue,
        meta,
      }),
    );

    expect(result.outcome).toBe('created');
    await expect(listCustomStatDefinitions(gameId)).resolves.toMatchObject([
      {
        stat_key: `${fieldType}_stat`,
        field_type: fieldType,
        default_value: defaultValue,
        meta,
      },
    ]);
  });

  test('concurrent equivalent retries produce one definition and one audit event', async () => {
    const gameId = await createGame('concurrent');
    const input = registration(gameId);

    const results = await Promise.all([
      registerCustomStatDefinition(input),
      registerCustomStatDefinition(input),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      'created',
      'existing_equivalent',
    ]);
    await expect(
      query<{ definitions: string; audits: string }>(
        `SELECT
           (SELECT count(*) FROM stat_template WHERE game_id = $1)::text AS definitions,
           (SELECT count(*) FROM custom_stat_registration_audit WHERE game_id = $1)::text AS audits`,
        [gameId],
      ),
    ).resolves.toMatchObject({ rows: [{ definitions: '1', audits: '1' }] });
  });

  test('does not alter the native StatTemplateDAO creation path', async () => {
    const gameId = await createGame('native-regression');
    await query(
      `INSERT INTO stat_template (
         game_id, stat_key, label, field_type, default_value, is_required, sort_order, meta
       )
       VALUES ($1, 'native', 'Native', 'short', NULL, TRUE, 0, '{}')`,
      [gameId],
    );

    await expect(listCustomStatDefinitions(gameId)).resolves.toMatchObject([
      { stat_key: 'native', label: 'Native' },
    ]);
    expect(await auditCount(gameId)).toBe(0);
  });
});
