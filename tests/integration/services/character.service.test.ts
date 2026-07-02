import { CharacterDAO } from '../../../src/dao/character.dao';
import { CharacterStatFieldDAO } from '../../../src/dao/character_stat_field.dao';
import { GameDAO } from '../../../src/dao/game.dao';
import { StatTemplateDAO } from '../../../src/dao/stat_template.dao';
import {
  getCharacterWithStats,
  updateStatMetaField,
} from '../../../src/services/character.service';

describe('character.service', () => {
  const characterDAO = new CharacterDAO();
  const gameDAO = new GameDAO();
  const statDAO = new CharacterStatFieldDAO();
  const templateDAO = new StatTemplateDAO();

  async function createGame() {
    return gameDAO.create({
      name: 'Final Fantasy Roleplay',
      description: 'Avalanche days',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });
  }

  test('hydrates all current game stat templates for an existing character', async () => {
    const game = await createGame();
    const level = await templateDAO.create({
      game_id: game.id,
      label: 'LEVEL',
      field_type: 'number',
      default_value: '1',
      sort_order: 10,
    });

    const character = await characterDAO.create({
      user_id: 'player-1',
      game_id: game.id,
      name: 'Robin Sage',
      bio: 'Expert marksman',
      avatar_url: null,
    });

    await statDAO.create(character.id, level.id, '5');

    await templateDAO.create({
      game_id: game.id,
      label: 'IMPROVEMENT POINTS',
      field_type: 'number',
      default_value: '0',
      sort_order: 20,
    });
    await templateDAO.create({
      game_id: game.id,
      label: 'TALENTS',
      field_type: 'short',
      sort_order: 30,
    });

    const hydrated = await getCharacterWithStats(character.id);

    expect(hydrated?.stats).toEqual([
      expect.objectContaining({
        template_id: level.id,
        label: 'LEVEL',
        field_type: 'number',
        value: '5',
        sort_index: 10,
      }),
      expect.objectContaining({
        label: 'IMPROVEMENT POINTS',
        field_type: 'number',
        value: '0',
        meta: {},
        sort_index: 20,
      }),
      expect.objectContaining({
        label: 'TALENTS',
        field_type: 'short',
        value: '',
        meta: {},
        sort_index: 30,
      }),
    ]);
  });

  test('creates missing stat rows when updating meta for a newly hydrated count field', async () => {
    const game = await createGame();
    const hp = await templateDAO.create({
      game_id: game.id,
      label: 'HP',
      field_type: 'count',
      sort_order: 10,
    });

    const character = await characterDAO.create({
      user_id: 'player-1',
      game_id: game.id,
      name: 'Cloud-ish Strife',
      bio: null,
      avatar_url: null,
    });

    expect(await statDAO.findByCharacter(character.id)).toHaveLength(0);

    await updateStatMetaField(character.id, hp.id, 'max', 12);

    expect(await statDAO.findByCharacter(character.id)).toEqual([
      expect.objectContaining({
        template_id: hp.id,
        value: '',
        meta: { max: 12 },
      }),
    ]);
  });

  test('persists roleplay display fields on character metadata', async () => {
    const game = await createGame();

    const character = await characterDAO.create({
      user_id: 'player-1',
      game_id: game.id,
      name: 'Garnet Til Alexandros',
      bio: null,
      avatar_url: 'https://example.com/full-profile.png',
      rp_display_name: 'Dagger',
      rp_display_avatar_url: 'https://example.com/rp-avatar.png',
    });

    expect(character).toEqual(
      expect.objectContaining({
        rp_display_name: 'Dagger',
        rp_display_avatar_url: 'https://example.com/rp-avatar.png',
      }),
    );

    const hydrated = await getCharacterWithStats(character.id);

    expect(hydrated).toEqual(
      expect.objectContaining({
        rp_display_name: 'Dagger',
        rp_display_avatar_url: 'https://example.com/rp-avatar.png',
      }),
    );
  });
});
