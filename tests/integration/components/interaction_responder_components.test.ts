import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';

import {
  handle as handleConfirmIcDelete,
  interactionPolicy as confirmIcDeletePolicy,
} from '../../../src/components/confirm_ic_delete_button';
import {
  handle as handlePublicCharacter,
  interactionPolicy as publicCharacterPolicy,
} from '../../../src/components/public_character_selector';
import {
  handle as handleSupportVerify,
  interactionPolicy as supportVerifyPolicy,
} from '../../../src/components/support_verify_button';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';

function interactionCallbacks() {
  return {
    replied: false,
    deferred: false,
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    showModal: jest.fn().mockResolvedValue(undefined),
  };
}

describe('simple components at the interaction responder boundary', () => {
  test('confirm delete routes ephemeral errors to followUp, preserving the original message', async () => {
    const callbacks = interactionCallbacks();
    const interaction = {
      ...callbacks,
      customId: 'confirmIcDelete:missing-payload',
      guildId: 'guild-1',
      user: { id: 'user-1' },
      client: {},
    } as unknown as ButtonInteraction;
    const responder = new DiscordInteractionResponder(interaction, confirmIcDeletePolicy.mode);

    await responder.acknowledge();
    await handleConfirmIcDelete(interaction, responder);

    expect(confirmIcDeletePolicy).toEqual({
      mode: { kind: 'component-update' },
      acknowledgement: 'auto-defer',
    });
    expect(callbacks.deferUpdate).toHaveBeenCalledTimes(1);
    // Ephemeral errors in component-update mode route to followUp so the
    // original message stays intact and the user gets a private error.
    expect(callbacks.followUp).toHaveBeenCalledWith({
      content: '⚠️ This delete confirmation is no longer valid.',
      ephemeral: true,
    });
    expect(callbacks.editReply).not.toHaveBeenCalled();
    expect(callbacks.reply).not.toHaveBeenCalled();
  });

  test('public character selection responds ephemerally when no value is selected', async () => {
    const callbacks = interactionCallbacks();
    const interaction = {
      ...callbacks,
      customId: 'selectPublicCharacter:0',
      values: [],
      user: { id: 'user-1' },
      guildId: 'guild-1',
    } as unknown as StringSelectMenuInteraction;
    const responder = new DiscordInteractionResponder(interaction, publicCharacterPolicy.mode);

    await handlePublicCharacter(interaction, responder);

    expect(callbacks.reply).toHaveBeenCalledWith({
      content: '⚠️ No character selected.',
      ephemeral: true,
    });
    expect(callbacks.update).not.toHaveBeenCalled();
  });

  test('support verification rejects the wrong guild through an ephemeral reply', async () => {
    const callbacks = interactionCallbacks();
    const interaction = {
      ...callbacks,
      guild: null,
      guildId: 'wrong-guild',
      user: { id: 'user-1' },
    } as unknown as ButtonInteraction;
    const responder = new DiscordInteractionResponder(interaction, supportVerifyPolicy.mode);

    await handleSupportVerify(interaction, responder);

    expect(supportVerifyPolicy.mode).toEqual({ kind: 'reply', visibility: 'ephemeral' });
    expect(callbacks.reply).toHaveBeenCalledWith({
      content: 'Use this verification button in the SPRITEbot support server.',
      ephemeral: true,
    });
  });
});
