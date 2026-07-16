const mockJoinVoiceChannel = jest.fn();
const mockEntersState = jest.fn();
const mockGetVoiceConnection = jest.fn();

jest.mock('@discordjs/voice', () => ({
  joinVoiceChannel: mockJoinVoiceChannel,
  entersState: mockEntersState,
  getVoiceConnection: mockGetVoiceConnection,
}));

import {
  destroyExistingDiscordVoiceConnection,
  joinDiscordVoiceChannel,
  waitForDiscordVoiceState,
} from '../../../src/discord/voice_operations';
import { defineDiscordOperationPolicy } from '../../../src/discord/operation_policy';

describe('Discord voice operation boundary', () => {
  beforeEach(() => {
    mockJoinVoiceChannel.mockReset();
    mockEntersState.mockReset();
    mockGetVoiceConnection.mockReset();
  });

  test('joins and waits for the requested connection state once', async () => {
    const connection = { destroy: jest.fn() };
    mockJoinVoiceChannel.mockReturnValue(connection);
    mockEntersState.mockResolvedValue(connection);

    await expect(
      joinDiscordVoiceChannel(policy('voice.test-join'), {
        channelId: 'voice-1',
        guildId: 'guild-1',
        adapterCreator: jest.fn() as never,
      }),
    ).resolves.toBe(connection);
    await expect(
      waitForDiscordVoiceState(
        policy('voice.test-ready'),
        connection as never,
        'ready' as never,
        20_000,
      ),
    ).resolves.toBe(connection);

    expect(mockJoinVoiceChannel).toHaveBeenCalledTimes(1);
    expect(mockEntersState).toHaveBeenCalledWith(connection, 'ready', 20_000);
  });

  test('destroys an existing connection through the bounded operation', async () => {
    const destroy = jest.fn();
    mockGetVoiceConnection.mockReturnValue({ destroy });

    await destroyExistingDiscordVoiceConnection(policy('voice.test-destroy'), 'guild-1');

    expect(mockGetVoiceConnection).toHaveBeenCalledWith('guild-1');
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

function policy(operation: string) {
  return defineDiscordOperationPolicy({ operation, timeoutMs: 1_000, totalBudgetMs: 1_000 });
}
