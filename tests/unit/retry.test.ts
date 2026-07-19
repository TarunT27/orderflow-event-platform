import { describe, expect, it } from 'vitest'
import { RetryableError, isRetryable, retryDelayMs } from '@/shared/retry.js'

describe('retry policy', () => {
  it.each([
    [1, 25],
    [2, 50],
    [3, 100],
    [9, 200],
  ])('uses capped exponential backoff for attempt %i', (attempt, expected) => {
    expect(retryDelayMs(attempt, { baseMs: 25, maxMs: 200 })).toBe(expected)
  })

  it('retries only explicitly transient failures', () => {
    expect(isRetryable(new RetryableError('upstream timeout'))).toBe(true)
    expect(isRetryable(new Error('card declined'))).toBe(false)
  })
})
