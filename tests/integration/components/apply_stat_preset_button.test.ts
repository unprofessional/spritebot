import type { ButtonInteraction } from 'discord.js';
import { GameDAO } from '../../../src/dao/game.dao';
import { StatTemplateDAO } from '../../../src/dao/stat_template.dao';
import { build, handle } from '../../../src/components/apply_stat_preset_button';
import type { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';

describe('apply custom-stat preset button', () => {
  test('builds the FFRP action and applies it only for the game owner', async () => {
    const game = await new GameDAO().create({
      name: 'Existing Game',
      description: '',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });
    expect(build(game.id).toJSON()).toMatchObject({
      custom_id: `applyStatPreset:${game.id}:ffrp`,
      label: '✨ Apply FFRP Preset',
    });

    const respond = jest.fn().mockResolvedValue(undefined);
    await handle(
      {
        customId: `applyStatPreset:${game.id}:ffrp`,
        user: { id: 'gm-1' },
      } as unknown as ButtonInteraction,
      { respond } as unknown as DiscordInteractionResponder,
    );

    expect((await new StatTemplateDAO().findByGame(game.id)).map((stat) => stat.stat_key)).toEqual([
      'hp',
      'fp',
    ]);
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Applied **FFRP v1**') }),
    );
  });

  test('rejects a non-owner without changing custom stats', async () => {
    const game = await new GameDAO().create({
      name: 'Owned Game',
      description: '',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });
    const respond = jest.fn().mockResolvedValue(undefined);

    await handle(
      {
        customId: `applyStatPreset:${game.id}:ffrp`,
        user: { id: 'player-1' },
      } as unknown as ButtonInteraction,
      { respond } as unknown as DiscordInteractionResponder,
    );

    await expect(new StatTemplateDAO().findByGame(game.id)).resolves.toEqual([]);
    expect(respond).toHaveBeenCalledWith({
      content: '⚠️ Only the GM can apply a custom-stat preset.',
      ephemeral: true,
    });
  });
});
