import type { StringSelectMenuInteraction } from 'discord.js';

import { interactionPolicy as characterFieldPolicy } from '../../../src/components/character_field_selector';
import { interactionPolicy as editCharacterFieldPolicy } from '../../../src/components/edit_character_field_selector';
import { interactionPolicy as statTypePolicy } from '../../../src/components/stat_type_selector';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import {
  getSelectMenuInteractionPolicy,
  handleSelectMenu,
} from '../../../src/handlers/select_menu_handlers';

function selectInteraction(customId: string, values: string[]) {
  return {
    customId,
    values,
    user: { id: 'user-1' },
    replied: false,
    deferred: false,
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    showModal: jest.fn().mockResolvedValue(undefined),
  } as unknown as StringSelectMenuInteraction;
}

async function routeSelector(customId: string, values: string[]) {
  const interaction = selectInteraction(customId, values);
  const policy = getSelectMenuInteractionPolicy(customId);
  expect(policy).toBeDefined();
  const responder = new DiscordInteractionResponder(interaction, policy!.mode);

  await handleSelectMenu(interaction, responder);

  return { interaction, policy };
}

describe('immediate modal selectors', () => {
  test('share the manual modal-first policy with authorization on modal submission', () => {
    const expected = {
      mode: { kind: 'modal-or-reply', visibility: 'ephemeral' },
      acknowledgement: 'manual',
      authorization: 'modal-submit',
    };

    expect(characterFieldPolicy).toEqual(expected);
    expect(editCharacterFieldPolicy).toEqual(expected);
    expect(statTypePolicy).toEqual(expected);
    expect(getSelectMenuInteractionPolicy('createCharacterDropdown')).toBe(characterFieldPolicy);
    expect(getSelectMenuInteractionPolicy('editCharacterFieldDropdown')).toBe(
      editCharacterFieldPolicy,
    );
    expect(getSelectMenuInteractionPolicy('selectStatType:game-1')).toBe(statTypePolicy);
  });

  test('preserves the create-character paragraph modal as the only acknowledgement', async () => {
    const { interaction } = await routeSelector('createCharacterDropdown', ['core:bio|Biography']);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modal = (interaction.showModal as jest.Mock).mock.calls[0][0].toJSON();
    expect(modal).toEqual(
      expect.objectContaining({
        custom_id: 'createDraftCharacterField:core:bio|Biography|',
        title: 'Enter value for Biography',
      }),
    );
    expect(modal.components[0].components[0]).toEqual(
      expect.objectContaining({ custom_id: 'core:bio', label: 'Value for Biography', style: 2 }),
    );
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test('preserves the edit-character count modal as the only acknowledgement', async () => {
    const { interaction } = await routeSelector('editCharacterFieldDropdown', [
      'game:hp|Hit Points|count',
    ]);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modal = (interaction.showModal as jest.Mock).mock.calls[0][0].toJSON();
    expect(modal).toEqual(
      expect.objectContaining({
        custom_id: 'createDraftCharacterField:game:hp|Hit Points|count',
        title: 'Enter value for Hit Points',
      }),
    );
    expect(
      modal.components.map(
        (row: { components: Array<{ custom_id: string }> }) => row.components[0].custom_id,
      ),
    ).toEqual(['game:hp:max', 'game:hp:current']);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test('preserves the stat-type modal as the only acknowledgement', async () => {
    const { interaction } = await routeSelector('selectStatType:game-1', ['paragraph']);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modal = (interaction.showModal as jest.Mock).mock.calls[0][0].toJSON();
    expect(modal).toEqual(
      expect.objectContaining({
        custom_id: 'createStatModal:game-1:paragraph',
        title: 'Add paragraph stat',
      }),
    );
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test.each([
    ['createCharacterDropdown', '⚠️ No selection made.'],
    ['editCharacterFieldDropdown', '⚠️ No selection made.'],
    ['selectStatType:game-1', '⚠️ Invalid stat type selection.'],
  ])('preserves the ephemeral validation reply for %s', async (customId, content) => {
    const { interaction } = await routeSelector(customId, []);

    expect(interaction.reply).toHaveBeenCalledWith({ content, ephemeral: true });
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });
});
