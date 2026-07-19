export class RetryableError extends Error {
  override readonly name = 'RetryableError'
}

export function isRetryable(error: unknown): error is RetryableError {
  return error instanceof RetryableError
}

export function retryDelayMs(
  attempt: number,
  options: { baseMs: number; maxMs: number } = { baseMs: 250, maxMs: 30_000 },
): number {
  const safeAttempt = Math.max(1, attempt)
  return Math.min(options.baseMs * 2 ** (safeAttempt - 1), options.maxMs)
}
