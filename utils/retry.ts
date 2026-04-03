/**
 * Retry transient failures on LLM/STT/TTS network calls.
 */

export interface WithRetryOptions {
  retries?: number;
  delayMs?: number;
  /** If true, multiply delay by (attempt + 1). */
  backoff?: boolean;
  /** Optional label for debugging. */
  label?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/abort/i.test(msg)) return false;
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|429|503|502|504/i.test(msg))
    return true;
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: WithRetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 1;
  const delayMs = opts.delayMs ?? 400;
  const backoff = opts.backoff ?? true;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (attempt >= retries || !isRetryableError(err)) throw err;
      const wait = backoff ? delayMs * (attempt + 1) : delayMs;
      await sleep(wait);
    }
  }
  throw last;
}
