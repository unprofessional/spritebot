import { GameDAO } from '../../../src/dao/game.dao';
import { StatTemplateDAO } from '../../../src/dao/stat_template.dao';
import {
  applyCustomStatPreset,
  createCustomStatDefinition,
} from '../../../src/services/custom_stat_definition.service';

describe('custom-stat definitions and presets', () => {
  const gameDAO = new GameDAO();
  const statTemplateDAO = new StatTemplateDAO();

  async function createGame() {
    return gameDAO.create({
      name: 'Preset Test',
      description: '',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });
  }

  test('applies FFRP v1 idempotently as ordinary editable definitions', async () => {
    const game = await createGame();

    const first = await applyCustomStatPreset(game.id, 'ffrp');
    const second = await applyCustomStatPreset(game.id, 'ffrp');

    expect(first.created.map((stat) => stat.stat_key)).toEqual(['hp', 'fp']);
    expect(second.created).toEqual([]);
    expect(second.existing.map((stat) => stat.stat_key)).toEqual(['hp', 'fp']);
    expect(await gameDAO.findById(game.id)).toMatchObject({
      preset_key: 'ffrp',
      preset_version: 1,
    });

    const hp = await statTemplateDAO.findByGameAndKey(game.id, 'hp');
    await expect(
      statTemplateDAO.updateById(hp!.id, { label: 'Health', default_value: '20' }),
    ).resolves.toMatchObject({ stat_key: 'hp', label: 'Health', default_value: '20' });
    await statTemplateDAO.deleteById(hp!.id);
    await expect(statTemplateDAO.findByGameAndKey(game.id, 'hp')).resolves.toBeNull();
  });

  test('preserves partial pre-existing definitions rather than overwriting them', async () => {
    const game = await createGame();
    await createCustomStatDefinition({
      game_id: game.id,
      stat_key: 'hp',
      label: 'Vitality',
      field_type: 'count',
      default_value: '42',
      sort_order: 7,
    });

    const result = await applyCustomStatPreset(game.id, 'ffrp');

    expect(result.existing).toEqual([
      expect.objectContaining({ stat_key: 'hp', label: 'Vitality', default_value: '42' }),
    ]);
    expect(result.created).toEqual([expect.objectContaining({ stat_key: 'fp', label: 'FP' })]);
  });

  test('handles concurrent preset application without duplicate definitions', async () => {
    const game = await createGame();

    await Promise.all([
      applyCustomStatPreset(game.id, 'ffrp'),
      applyCustomStatPreset(game.id, 'ffrp'),
    ]);

    expect((await statTemplateDAO.findByGame(game.id)).map((stat) => stat.stat_key)).toEqual([
      'hp',
      'fp',
    ]);
  });

  test('requires valid stable keys for the Prime-owned creation contract', async () => {
    const game = await createGame();

    await expect(
      createCustomStatDefinition({
        game_id: game.id,
        stat_key: 'Health Points',
        label: 'HP',
      }),
    ).rejects.toThrow('Stat key must start');
  });
});
