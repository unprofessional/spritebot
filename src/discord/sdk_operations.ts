import { REST, Routes } from 'discord.js';

import { executeDiscordOperation } from './operation_executor';
import type { DiscordOperationPolicy } from './operation_policy';

type MethodKey<T> = {
  [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T];

type MethodArgs<T, K extends MethodKey<T>> = T[K] extends (...args: infer A) => unknown ? A : never;
type MethodResult<T, K extends MethodKey<T>> = T[K] extends (...args: never[]) => infer R
  ? Awaited<R>
  : never;

/**
 * Executes a discord.js method without exposing its direct call outside the boundary package.
 * The target is retained as `this`, which is required by discord.js managers and structures.
 */
export async function executeDiscordSdkMethod<T extends object, K extends MethodKey<T>>(
  policy: DiscordOperationPolicy,
  target: T,
  method: K,
  ...args: MethodArgs<T, K>
): Promise<MethodResult<T, K>> {
  const candidate = target[method];
  if (typeof candidate !== 'function') {
    throw new TypeError(`Discord SDK method ${String(method)} is not callable.`);
  }

  return executeDiscordOperation(policy, async () =>
    Promise.resolve(candidate.apply(target, args) as MethodResult<T, K>),
  );
}

/** Explicit-result variant for discord.js methods whose overloads cannot be inferred reliably. */
export async function executeDiscordSdkMethodAs<TResult>(
  policy: DiscordOperationPolicy,
  target: object,
  method: PropertyKey,
  ...args: unknown[]
): Promise<TResult> {
  const candidate = (target as Record<PropertyKey, unknown>)[method];
  if (typeof candidate !== 'function') {
    throw new TypeError(`Discord SDK method ${String(method)} is not callable.`);
  }

  return executeDiscordOperation(policy, async () =>
    Promise.resolve(candidate.apply(target, args) as TResult),
  );
}

export function createDiscordRestClient(token: string): REST {
  return new REST({ version: '10' }).setToken(token);
}

export function applicationCommandsRoute(applicationId: string, guildId?: string): `/${string}` {
  return guildId
    ? Routes.applicationGuildCommands(applicationId, guildId)
    : Routes.applicationCommands(applicationId);
}

class DiscordHttpStatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Discord resource request failed with status ${status}.`);
    this.name = 'DiscordHttpStatusError';
    this.status = status;
  }
}

export async function fetchDiscordTextResource(
  policy: DiscordOperationPolicy,
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  return executeDiscordOperation(policy, async ({ signal }) => {
    const response = await fetchImpl(url, { signal });
    if (!response.ok) throw new DiscordHttpStatusError(response.status);
    return response.text();
  });
}
