const mockGet = jest.fn();
const mockTouchLastBumped = jest.fn();

jest.mock('../../../src/dao/thread_bump.dao', () => ({
  ThreadBumpDAO: jest.fn().mockImplementation(() => ({
    get: mockGet,
    touchLastBumped: mockTouchLastBumped,
  })),
}));

import { ThreadBumpService } from '../../../src/services/thread_bump.service';

describe('ThreadBumpService Discord operation policy', () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue(null);
    mockTouchLastBumped.mockReset().mockResolvedValue(undefined);
  });

  test('does not retry an indeterminate bump send', async () => {
    const send = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
    const client = clientWithThread(send);

    await expect(new ThreadBumpService().bumpNow(client as never, 'thread-1')).rejects.toThrow(
      'result was indeterminate',
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(mockTouchLastBumped).toHaveBeenCalledTimes(1);
  });

  test('keeps a manually requested bump visible', async () => {
    const deletion = jest.fn().mockResolvedValue(undefined);
    const send = jest.fn().mockResolvedValue({ delete: deletion });

    await new ThreadBumpService().bumpNow(clientWithThread(send) as never, 'thread-1', {
      deleteAfter: false,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(mockTouchLastBumped).toHaveBeenCalledTimes(1);
    expect(deletion).not.toHaveBeenCalled();
  });
});

function clientWithThread(send: jest.Mock) {
  return {
    channels: {
      fetch: jest.fn().mockResolvedValue({
        archived: false,
        locked: false,
        isThread: () => true,
        guild: { members: { me: { permissions: { has: () => true } } } },
        send,
      }),
    },
  };
}
