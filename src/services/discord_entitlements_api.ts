import type { ClassifiedDiscordError } from '../discord/errors';
import {
  DiscordOperationError,
  executeDiscordOperation,
  type DiscordOperationDependencies,
} from '../discord/operation_executor';
import { defineDiscordOperationPolicy } from '../discord/operation_policy';

const API_BASE = 'https://discord.com/api/v10';

export const entitlementReadPolicy = defineDiscordOperationPolicy({
  operation: 'entitlements.fetch-guild',
  timeoutMs: 800,
  totalBudgetMs: 2_000,
  retry: 'safe-read',
  maxAttempts: 2,
});

export type DiscordEntitlement = Record<string, unknown> & {
  id: string;
  sku_id: string;
  user_id?: string | null;
  guild_id?: string | null;
  application_id: string;
  starts_at?: string | null;
  ends_at?: string | null;
};

export type DiscordEntitlementsFetchResult =
  | { ok: true; entitlements: DiscordEntitlement[] }
  | { ok: false; failure: ClassifiedDiscordError };

interface EntitlementsApiDependencies {
  fetch?: typeof fetch;
  operation?: DiscordOperationDependencies;
}

class DiscordEntitlementsHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(status: number, retryAfterMs?: number) {
    super(`Discord entitlements request failed with status ${status}.`);
    this.name = 'DiscordEntitlementsHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export async function fetchGuildEntitlementsLazy(
  opts: {
    applicationId: string;
    botToken: string;
    guildId: string;
    limit?: number;
  },
  dependencies: EntitlementsApiDependencies = {},
): Promise<DiscordEntitlementsFetchResult> {
  const { applicationId, botToken, guildId, limit = 100 } = opts;
  const fetchImpl = dependencies.fetch ?? fetch;
  const url = new URL(`${API_BASE}/applications/${applicationId}/entitlements`);
  url.searchParams.set('guild_id', guildId);
  url.searchParams.set('limit', String(limit));

  try {
    const entitlements = await executeDiscordOperation(
      entitlementReadPolicy,
      async ({ signal }) => {
        const response = await fetchImpl(url.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bot ${botToken}`,
            'Content-Type': 'application/json',
          },
          signal,
        });

        if (!response.ok) {
          throw new DiscordEntitlementsHttpError(
            response.status,
            readRetryAfterMs(response.headers.get('retry-after')),
          );
        }

        const data = (await response.json()) as unknown;
        if (!Array.isArray(data)) {
          throw new TypeError('Discord entitlements response was not an array.');
        }

        return data.map(normalizeEntitlement);
      },
      dependencies.operation,
    );

    return { ok: true, entitlements };
  } catch (error) {
    if (error instanceof DiscordOperationError) {
      return { ok: false, failure: error.classified };
    }
    throw error;
  }
}

function normalizeEntitlement(raw: unknown): DiscordEntitlement {
  const entitlement = raw as Record<string, unknown>;
  return {
    ...entitlement,
    id: String(entitlement.id),
    sku_id: String(entitlement.sku_id),
    user_id: readOptionalString(entitlement.user_id),
    guild_id: readOptionalString(entitlement.guild_id),
    application_id: String(entitlement.application_id),
    starts_at: readOptionalString(entitlement.starts_at),
    ends_at: readOptionalString(entitlement.ends_at),
  };
}

function readOptionalString(value: unknown): string | null {
  return value ? String(value) : null;
}

function readRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.round(seconds * 1_000);
}
