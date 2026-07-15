import { Client, Events } from 'discord.js';

import { initializeEntitlementEvents } from '../../../src/client/entitlement_events';
import { initializeRoleplayProxy } from '../../../src/client/rp_proxy_events';
import { initializeSupportVerificationEvents } from '../../../src/client/support_verification_events';
import {
  beginDrain,
  getInFlightOperations,
  resetLifecycleForTests,
  waitForIdle,
} from '../../../src/runtime/lifecycle';
import { handleRoleplayProxyMessage } from '../../../src/services/rp_message_proxy.service';
import { verifySupportMember } from '../../../src/services/support_verification.service';

jest.mock('../../../src/dao/entitlements_cache.dao', () => ({
  __mockUpsertFromWebhook: jest.fn(),
  EntitlementsCacheDAO: jest.fn().mockImplementation(() => ({
    upsertFromWebhook: jest.requireMock('../../../src/dao/entitlements_cache.dao')
      .__mockUpsertFromWebhook,
  })),
}));
jest.mock('../../../src/services/rp_message_proxy.service', () => ({
  handleRoleplayProxyMessage: jest.fn(),
}));
jest.mock('../../../src/services/support_verification.service', () => ({
  verifySupportMember: jest.fn(),
}));

const mockHandleRoleplayProxyMessage = jest.mocked(handleRoleplayProxyMessage);
const mockVerifySupportMember = jest.mocked(verifySupportMember);
const { __mockUpsertFromWebhook: mockUpsertFromWebhook } = jest.requireMock(
  '../../../src/dao/entitlements_cache.dao',
) as { __mockUpsertFromWebhook: jest.Mock };

describe('Discord drain handler wrappers', () => {
  beforeEach(() => {
    resetLifecycleForTests();
    jest.clearAllMocks();
    mockUpsertFromWebhook.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetLifecycleForTests();
  });

  test('tracks roleplay proxy message work as an in-flight operation', async () => {
    const client = fakeClient();
    const release = deferred<void>();
    mockHandleRoleplayProxyMessage.mockReturnValue(release.promise);

    initializeRoleplayProxy(client as unknown as Client);
    client.emitEvent(Events.MessageCreate, { id: 'message-1' });
    await flushPromises();

    expect(getInFlightOperations()).toEqual([
      expect.objectContaining({ name: 'message:rp-proxy' }),
    ]);

    const waiting = waitForIdle(1_000);
    release.resolve();
    await expect(waiting).resolves.toMatchObject({ idle: true, timedOut: false });
  });

  test('skips roleplay proxy messages once draining begins', async () => {
    const client = fakeClient();
    initializeRoleplayProxy(client as unknown as Client);

    beginDrain('test');
    client.emitEvent(Events.MessageCreate, { id: 'message-1' });
    await flushPromises();

    expect(mockHandleRoleplayProxyMessage).not.toHaveBeenCalled();
  });

  test('tracks entitlement events and skips new entitlement work while draining', async () => {
    const client = fakeClient();
    initializeEntitlementEvents(client as unknown as Client);

    client.emitEvent(Events.EntitlementCreate, entitlement('entitlement-1'));
    await waitForIdle(1_000);
    expect(mockUpsertFromWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        entitlementId: 'entitlement-1',
        guildId: 'guild-1',
        status: 'active',
      }),
    );

    beginDrain('test');
    client.emitEvent(Events.EntitlementDelete, entitlement('entitlement-2'));
    await flushPromises();

    expect(mockUpsertFromWebhook).toHaveBeenCalledTimes(1);
  });

  test('tracks support verification joins and skips new joins while draining', async () => {
    const client = fakeClient();
    initializeSupportVerificationEvents(client as unknown as Client);

    client.emitEvent(Events.GuildMemberAdd, {
      id: 'member-1',
      guild: { id: '1526058725587292160' },
    });
    await waitForIdle(1_000);
    expect(mockVerifySupportMember).toHaveBeenCalledTimes(1);

    beginDrain('test');
    client.emitEvent(Events.GuildMemberAdd, {
      id: 'member-2',
      guild: { id: '1526058725587292160' },
    });
    await flushPromises();

    expect(mockVerifySupportMember).toHaveBeenCalledTimes(1);
  });
});

function fakeClient(): {
  on: jest.Mock;
  emitEvent(event: string, ...args: unknown[]): void;
} {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return undefined;
    }),
    emitEvent(event: string, ...args: unknown[]) {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`No handler registered for ${event}`);
      handler(...args);
    },
  };
}

function entitlement(id: string): {
  id: string;
  skuId: string;
  guildId: string;
  userId: string | null;
  startsTimestamp: number;
  endsTimestamp: number | null;
  deleted: boolean;
} {
  return {
    id,
    skuId: 'sku-1',
    guildId: 'guild-1',
    userId: null,
    startsTimestamp: Date.parse('2026-07-15T00:00:00.000Z'),
    endsTimestamp: null,
    deleted: false,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
