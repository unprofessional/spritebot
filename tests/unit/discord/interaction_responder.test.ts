import {
  DiscordInteractionResponder,
  InteractionResponseStateError,
} from '../../../src/discord/interaction_responder';

describe('DiscordInteractionResponder', () => {
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('uses reply for the first immediate reply-mode response', async () => {
    const interaction = replyInteraction();
    const responder = new DiscordInteractionResponder(interaction as never, {
      kind: 'reply',
      visibility: 'public',
    });

    await responder.respond({ content: 'hello' });

    expect(interaction.reply).toHaveBeenCalledWith({ content: 'hello', ephemeral: false });
    expect(responder.state).toBe('replied');
  });

  test('defers before work and edits the deferred reply with fixed visibility', async () => {
    const interaction = replyInteraction();
    const responder = new DiscordInteractionResponder(interaction as never, {
      kind: 'reply',
      visibility: 'ephemeral',
    });

    await responder.acknowledge();
    await responder.respond({ content: 'finished' });

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'finished' });
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(responder.state).toBe('replied');
  });

  test('uses followUp for additional content after replying', async () => {
    const interaction = replyInteraction();
    const responder = new DiscordInteractionResponder(interaction as never, {
      kind: 'reply',
      visibility: 'ephemeral',
    });

    await responder.respond({ content: 'first' });
    await responder.respond({ content: 'second' });

    expect(interaction.followUp).toHaveBeenCalledWith({ content: 'second', ephemeral: true });
  });

  test('supports immediate and deferred component update paths', async () => {
    const immediate = componentInteraction();
    const immediateResponder = new DiscordInteractionResponder(immediate as never, {
      kind: 'component-update',
    });
    await immediateResponder.respond({ content: 'updated' });
    expect(immediate.update).toHaveBeenCalledWith({ content: 'updated' });

    const deferred = componentInteraction();
    const deferredResponder = new DiscordInteractionResponder(deferred as never, {
      kind: 'component-update',
    });
    await deferredResponder.acknowledge();
    await deferredResponder.respond({ content: 'updated later' });
    expect(deferred.deferUpdate).toHaveBeenCalledTimes(1);
    expect(deferred.editReply).toHaveBeenCalledWith({ content: 'updated later' });
    expect(deferred.update).not.toHaveBeenCalled();
  });

  test('routes ephemeral respond to followUp in component-update mode when unacknowledged', async () => {
    const interaction = componentInteraction();
    const responder = new DiscordInteractionResponder(interaction as never, {
      kind: 'component-update',
    });

    await responder.respond({ content: 'no permission', ephemeral: true });

    // Should auto-defer then follow up ephemerally, leaving original message intact
    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'no permission',
      ephemeral: true,
    });
    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  test('routes ephemeral respond to followUp in component-update mode when already deferred', async () => {
    const interaction = componentInteraction();
    const responder = new DiscordInteractionResponder(interaction as never, {
      kind: 'component-update',
    });

    await responder.acknowledge();
    await responder.respond({ content: 'error occurred', ephemeral: true });

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'error occurred',
      ephemeral: true,
    });
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  test('followUp preserves ephemeral flag in component-update mode', async () => {
    const interaction = componentInteraction();
    const responder = new DiscordInteractionResponder(interaction as never, {
      kind: 'component-update',
    });

    await responder.acknowledge();
    await responder.respond({ content: 'updated' });
    await responder.followUp({ content: 'side note', ephemeral: true });

    expect(interaction.followUp).toHaveBeenCalledWith({ content: 'side note', ephemeral: true });
  });

  test('uses showModal as the only initial acknowledgement for modal mode', async () => {
    const interaction = componentInteraction();
    const responder = new DiscordInteractionResponder(interaction as never, { kind: 'modal' });
    const modal = { customId: 'edit:modal' };

    await responder.showModal(modal as never);

    expect(interaction.showModal).toHaveBeenCalledWith(modal);
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(responder.state).toBe('modal_shown');
  });

  test('shows a prepared modal immediately when hybrid mode is still unacknowledged', async () => {
    const interaction = componentInteraction();
    const responder = new DiscordInteractionResponder(interaction as never, {
      kind: 'modal-or-reply',
      visibility: 'ephemeral',
    });
    const modal = { customId: 'edit:modal' };

    await expect(responder.presentModal(modal as never)).resolves.toBe('shown');

    expect(interaction.showModal).toHaveBeenCalledWith(modal);
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(responder.state).toBe('modal_shown');
  });

  test('requests activation when hybrid mode was deferred before modal preparation completed', async () => {
    const interaction = componentInteraction();
    const responder = new DiscordInteractionResponder(interaction as never, {
      kind: 'modal-or-reply',
      visibility: 'ephemeral',
    });

    await responder.acknowledge();
    await expect(responder.presentModal({ customId: 'edit:modal' } as never)).resolves.toBe(
      'requires_activation',
    );
    await responder.respond({ content: 'Editor ready.', ephemeral: true });

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'Editor ready.' });
  });

  test('marks an expired session and suppresses every later callback', async () => {
    const interaction = replyInteraction();
    interaction.reply.mockRejectedValueOnce({ code: 10062, status: 404 });
    const responder = new DiscordInteractionResponder(interaction as never, {
      kind: 'reply',
      visibility: 'ephemeral',
    });

    await responder.respond({ content: 'too late' });
    await responder.respond({ content: 'do not retry' });
    await responder.followUp({ content: 'also suppressed' });

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(responder.state).toBe('expired');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('reconciles 40060 from Discord state without retrying the callback', async () => {
    const interaction = replyInteraction();
    interaction.reply.mockImplementationOnce(async () => {
      interaction.replied = true;
      throw { code: 40060, status: 400 };
    });
    const responder = new DiscordInteractionResponder(interaction as never, {
      kind: 'reply',
      visibility: 'public',
    });

    await responder.respond({ content: 'raced' });

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(responder.state).toBe('replied');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('serializes concurrent responses so only one initial acknowledgement wins', async () => {
    let finishReply: (() => void) | undefined;
    const interaction = replyInteraction();
    interaction.reply.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishReply = resolve;
        }),
    );
    const responder = new DiscordInteractionResponder(interaction as never, {
      kind: 'reply',
      visibility: 'public',
    });

    const first = responder.respond({ content: 'first' });
    const second = responder.respond({ content: 'second' });
    await Promise.resolve();

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).not.toHaveBeenCalled();

    finishReply?.();
    await Promise.all([first, second]);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({ content: 'second', ephemeral: false });
  });

  test('rejects a visibility change after an ephemeral deferral', async () => {
    const interaction = replyInteraction();
    const responder = new DiscordInteractionResponder(interaction as never, {
      kind: 'reply',
      visibility: 'ephemeral',
    });
    await responder.acknowledge();

    await expect(
      responder.respond({ content: 'public now', ephemeral: false }),
    ).rejects.toBeInstanceOf(InteractionResponseStateError);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});

function replyInteraction() {
  return {
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
}

function componentInteraction() {
  return {
    ...replyInteraction(),
    type: 3,
  };
}
