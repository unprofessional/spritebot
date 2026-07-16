import type { ChatInputCommandInteraction } from 'discord.js';

import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import { handleAdminRestoreCharacter } from '../../../src/handlers/admin_restore.handler';
import { restoreCharacterAsAdmin } from '../../../src/services/character.service';

jest.mock('../../../src/services/character.service', () => ({
  restoreCharacterAsAdmin: jest.fn(),
}));

const mockedRestoreCharacterAsAdmin = jest.mocked(restoreCharacterAsAdmin);

describe('admin restore handler responder boundary', () => {
  test('edits the command deferral with the restored character result', async () => {
    mockedRestoreCharacterAsAdmin.mockResolvedValue({
      ok: true,
      character: { name: 'Mira' },
    } as Awaited<ReturnType<typeof restoreCharacterAsAdmin>>);
    const interaction = {
      options: { getString: jest.fn().mockReturnValue(' character-1 ') },
      replied: false,
      deferred: false,
      reply: jest.fn(),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn(),
    } as unknown as ChatInputCommandInteraction;
    const responder = new DiscordInteractionResponder(interaction, {
      kind: 'reply',
      visibility: 'ephemeral',
    });

    await responder.acknowledge();
    await handleAdminRestoreCharacter(interaction, responder);

    expect(mockedRestoreCharacterAsAdmin).toHaveBeenCalledWith('character-1');
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '✅ Restored **Mira** as a private character.',
    });
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
