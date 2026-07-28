import { GameDAO } from '../../../src/dao/game.dao';
import { StatTemplateDAO } from '../../../src/dao/stat_template.dao';

describe('StatTemplateDAO update allowlist', () => {
  test.each(['stat_key', 'game_id', 'unknown_column'])(
    'rejects %s before constructing an update query',
    async (field) => {
      const game = await new GameDAO().create({
        name: 'Allowlist',
        description: '',
        created_by: 'gm-1',
        guild_id: 'guild-1',
      });
      const dao = new StatTemplateDAO();
      const template = await dao.create({
        game_id: game.id,
        stat_key: 'stress',
        label: 'Stress',
      });

      await expect(
        dao.updateById(template.id, { [field]: 'malicious-value' } as never),
      ).rejects.toThrow(`Unsupported stat template update field(s): ${field}`);
      await expect(dao.findById(template.id)).resolves.toMatchObject({
        game_id: game.id,
        stat_key: 'stress',
        label: 'Stress',
      });
    },
  );
});
