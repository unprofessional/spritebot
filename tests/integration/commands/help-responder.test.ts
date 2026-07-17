import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../../../src/discord/interaction_dispatch';

type HelpCommand = {
  interactionPolicy: InteractionDispatchPolicy;
  execute(interaction: unknown, context: InteractionCommandContext): Promise<unknown>;
};

const helpCommand = require('../../../src/commands/help') as HelpCommand;

describe('/help responder contract', () => {
  test('keeps the initial help response ephemeral through its reply policy', async () => {
    const interaction = {
      type: 2,
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
    const responder = new DiscordInteractionResponder(
      interaction as never,
      helpCommand.interactionPolicy.mode,
    );

    await helpCommand.execute(interaction, { responder });

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
        ephemeral: true,
      }),
    );
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
});
