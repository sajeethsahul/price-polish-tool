// ─── Configuration ────────────────────────────────────────────────────────────

/** Maximum number of retry attempts after the initial call.
 *  Total attempts = MAX_RETRIES + 1. */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms). Doubles per attempt before jitter. */
const BASE_DELAY_MS = 500;

/** Upper bound on computed backoff delay regardless of attempt count (ms). */
const MAX_DELAY_MS = 10_000;

// ─── Internals ────────────────────────────────────────────────────────────────

/** HTTP status codes that indicate a transient server-side or rate-limiting problem. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Node.js error codes that represent recoverable network failures. */
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EPIPE",
  "ECONNABORTED",
]);

function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code ?? "";
  if (RETRYABLE_ERROR_CODES.has(code)) return true;
  // Fallback: message-based detection for fetch-polyfill environments.
  const msg = err.message.toLowerCase();
  return (
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("network request failed") ||
    msg.includes("connection was forcibly closed")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Computes the wait duration before the next retry attempt.
 * Honoring the Retry-After header takes precedence over backoff when present.
 */
function nextDelayMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds != null && Number.isFinite(retryAfterSeconds)) {
    return Math.round(retryAfterSeconds * 1000);
  }
  const base = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = base * 0.2 * Math.random(); // ±20% jitter
  return Math.round(base + jitter);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Wraps a Shopify `admin.graphql()` call with automatic retry for transient failures.
 *
 * ✅ Retries on:
 *   - HTTP 429  — rate limiting (honours Retry-After header when present)
 *   - HTTP 5xx  — transient server errors
 *   - Network errors: ECONNRESET, ETIMEDOUT, ECONNREFUSED, EPIPE, ECONNABORTED
 *
 * ❌ Never retries:
 *   - HTTP 200 with GraphQL `userErrors`  — business/validation errors (caller's responsibility)
 *   - HTTP 400, 401, 403, 404            — permanent client errors
 *   - Non-transient application exceptions
 *
 * On retry exhaustion:
 *   - Network error  → re-throws the last error (hits caller's catch block as before)
 *   - HTTP error     → returns the final error Response (caller receives non-200 status)
 *
 * @param fn      Zero-arg function that executes the graphql call.
 * @param context Optional label for log messages.
 */
export async function withShopifyRetry(
  fn: () => Promise<Response>,
  context = "shopify.graphql"
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;

    // ── Network call ──────────────────────────────────────────────────────────
    try {
      response = await fn();
    } catch (err) {
      if (!isRetryableNetworkError(err) || attempt === MAX_RETRIES) {
        if (attempt > 0) {
          console.warn(`[GRAPHQL] ${context}.retry.exhausted`, {
            cause: err instanceof Error ? err.message : String(err),
            attempts: attempt + 1,
          });
        }
        throw err;
      }
      const delay = nextDelayMs(attempt);
      console.warn(`[GRAPHQL] ${context}.retry.network`, {
        cause: err instanceof Error ? err.message : String(err),
        attempt: attempt + 1,
        delayMs: delay,
      });
      await sleep(delay);
      continue;
    }

    // ── HTTP response ─────────────────────────────────────────────────────────
    if (!RETRYABLE_STATUSES.has(response.status)) {
      // HTTP 200 (success or GraphQL userErrors for caller to handle),
      // or a permanent client error (4xx) — return as-is.
      return response;
    }

    if (attempt === MAX_RETRIES) {
      console.warn(`[GRAPHQL] ${context}.retry.exhausted`, {
        status: response.status,
        attempts: attempt + 1,
      });
      return response; // caller receives the final error response
    }

    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfterSec = retryAfterHeader ? parseFloat(retryAfterHeader) : undefined;
    const delay = nextDelayMs(attempt, retryAfterSec);

    console.warn(`[GRAPHQL] ${context}.retry.http`, {
      status: response.status,
      attempt: attempt + 1,
      delayMs: delay,
    });
    await sleep(delay);
  }

  // Unreachable — satisfies TypeScript's return-path analysis.
  throw new Error(`[GRAPHQL] ${context}: retry loop exited unexpectedly`);
}
