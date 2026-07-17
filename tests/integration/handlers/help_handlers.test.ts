import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';

import type { FeatureKey } from '../../../src/access/features';
import type { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';

const getHelpFeatures = jest.fn();
jest.mock('../../../src/services/help.service', () => ({ getHelpFeatures }));

import { handle as handleCategory } from '../../../src/handlers/help/help_category_select';
import { handle as handleRole } from '../../../src/handlers/help/help_role_button';

const features = new Set<FeatureKey>(['core', 'rpg:characters']);

describe('help handlers', () => {
  beforeEach(() => {
    getHelpFeatures.mockReset().mockResolvedValue({ ok: true, features });
  });

  test('player role updates the message with an entitlement-filtered menu', async () => {
    const responder = mockResponder();

    await handleRole(button('help:role:player'), responder);

    expect(getHelpFeatures).toHaveBeenCalledWith('guild-1');
    expect(responder.respond).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array), components: expect.any(Array) }),
    );
    expect(JSON.stringify(responder.respond.mock.calls[0][0].components)).not.toContain(
      'Voice Transcription',
    );
  });

  test('back returns to role selection without another entitlement lookup', async () => {
    const responder = mockResponder();

    await handleRole(button('help:back'), responder);

    expect(getHelpFeatures).not.toHaveBeenCalled();
    expect(JSON.stringify(responder.respond.mock.calls[0][0].components)).toContain(
      'help:role:player',
    );
  });

  test('category selection updates the message with category details', async () => {
    const responder = mockResponder();

    await handleCategory(select('help:category:player', 'characters'), responder);

    expect(responder.respond).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array), components: expect.any(Array) }),
    );
    expect(responder.respond.mock.calls[0][0].embeds[0].toJSON().title).toBe('🧙 Characters');
  });

  test('rejects a category hidden by the current feature set', async () => {
    const responder = mockResponder();

    await handleCategory(select('help:category:player', 'inventory'), responder);

    expect(responder.respond).toHaveBeenCalledWith({
      content: 'That help topic is not available for this server.',
      components: [],
    });
  });
});

function mockResponder() {
  return {
    respond: jest.fn().mockResolvedValue(undefined),
  } as unknown as DiscordInteractionResponder & { respond: jest.Mock };
}

function button(customId: string): ButtonInteraction {
  return { customId, guildId: 'guild-1' } as unknown as ButtonInteraction;
}

function select(customId: string, value: string): StringSelectMenuInteraction {
  return {
    customId,
    values: [value],
    guildId: 'guild-1',
  } as unknown as StringSelectMenuInteraction;
}
