export type DiscordRetryPolicy = 'never' | 'safe-read' | 'idempotent-write';

export interface DiscordOperationPolicy {
  operation: string;
  timeoutMs: number;
  totalBudgetMs: number;
  retry: DiscordRetryPolicy;
  maxAttempts: number;
}

export type DiscordOperationPolicyInput = Omit<DiscordOperationPolicy, 'retry' | 'maxAttempts'> &
  Partial<Pick<DiscordOperationPolicy, 'retry' | 'maxAttempts'>>;

const safeOperationName = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export function defineDiscordOperationPolicy(
  input: DiscordOperationPolicyInput,
): DiscordOperationPolicy {
  if (!safeOperationName.test(input.operation)) {
    throw new TypeError('Discord operation names must be safe, non-secret labels.');
  }
  assertPositiveFiniteInteger(input.timeoutMs, 'timeoutMs');
  assertPositiveFiniteInteger(input.totalBudgetMs, 'totalBudgetMs');

  const retry = input.retry ?? 'never';
  const maxAttempts = input.maxAttempts ?? 1;
  assertPositiveFiniteInteger(maxAttempts, 'maxAttempts');

  return {
    operation: input.operation,
    timeoutMs: input.timeoutMs,
    totalBudgetMs: input.totalBudgetMs,
    retry,
    maxAttempts,
  };
}

function assertPositiveFiniteInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer.`);
  }
}
