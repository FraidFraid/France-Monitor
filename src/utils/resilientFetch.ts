/**
 * resilientFetch.ts — Fetch wrapper with retry logic and exponential backoff.
 *
 * Features:
 * - Configurable retry count and delays
 * - Exponential backoff with jitter
 * - Timeout support via AbortSignal
 * - Graceful degradation with stale cache fallback
 */

export interface ResilientFetchOptions {
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;
  /** Number of retry attempts (default: 2) */
  retries?: number;
  /** Base delay between retries in ms (default: 1000) */
  retryDelay?: number;
  /** Maximum delay between retries in ms (default: 10000) */
  maxRetryDelay?: number;
  /** Add jitter to retry delays (default: true) */
  jitter?: boolean;
  /** Custom headers to include */
  headers?: Record<string, string>;
}

export interface ResilientFetchResult<T> {
  data: T | null;
  ok: boolean;
  status: number;
  error?: string;
  attempts: number;
  cached?: boolean;
}

// Simple in-memory cache for stale-while-revalidate pattern
const staleCache = new Map<string, { data: unknown; timestamp: number }>();
const STALE_TTL_MS = 30 * 60_000; // 30 minutes stale tolerance

/**
 * Fetch with automatic retry and exponential backoff.
 *
 * @example
 * const result = await resilientFetch<{ results: Item[] }>(
 *   'https://api.example.com/data',
 *   { retries: 3, timeout: 5000 }
 * );
 * if (result.ok && result.data) {
 *   console.log(result.data.results);
 * }
 */
export async function resilientFetch<T>(
  url: string,
  options: ResilientFetchOptions = {}
): Promise<ResilientFetchResult<T>> {
  const {
    timeout = 10_000,
    retries = 2,
    retryDelay = 1_000,
    maxRetryDelay = 10_000,
    jitter = true,
    headers = {},
  } = options;

  let lastError: Error | null = null;
  let attempts = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    attempts = attempt + 1;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          ...headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Don't retry on client errors (4xx) except 429 (rate limit)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return {
            data: null,
            ok: false,
            status: response.status,
            error: `HTTP ${response.status}: ${response.statusText}`,
            attempts,
          };
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as T;

      // Update stale cache on success
      staleCache.set(url, { data, timestamp: Date.now() });

      return {
        data,
        ok: true,
        status: response.status,
        attempts,
      };

    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Log warning for debugging
      console.warn(
        `[resilientFetch] Attempt ${attempt + 1}/${retries + 1} failed for ${url}:`,
        lastError.message
      );

      // Don't delay after last attempt
      if (attempt < retries) {
        // Exponential backoff: delay * 2^attempt
        let delay = Math.min(retryDelay * Math.pow(2, attempt), maxRetryDelay);

        // Add jitter (0-25% of delay)
        if (jitter) {
          delay += Math.random() * delay * 0.25;
        }

        await sleep(delay);
      }
    }
  }

  // All retries exhausted - try stale cache
  const stale = staleCache.get(url);
  if (stale && Date.now() - stale.timestamp < STALE_TTL_MS) {
    console.warn(`[resilientFetch] Returning stale data for ${url} (age: ${Math.round((Date.now() - stale.timestamp) / 1000)}s)`);
    return {
      data: stale.data as T,
      ok: true,
      status: 200,
      attempts,
      cached: true,
    };
  }

  console.error(`[resilientFetch] All ${retries + 1} attempts failed for ${url}`);
  return {
    data: null,
    ok: false,
    status: 0,
    error: lastError?.message ?? 'Unknown error',
    attempts,
  };
}

/**
 * Fetch JSON with retry, extracting results array from DataFair-style response.
 */
export async function resilientFetchResults<T>(
  url: string,
  options?: ResilientFetchOptions
): Promise<T[]> {
  const result = await resilientFetch<{ results?: T[] }>(url, options);
  if (result.ok && result.data?.results) {
    return result.data.results;
  }
  return [];
}

/**
 * Clear stale cache for a specific URL or all entries.
 */
export function clearStaleCache(url?: string): void {
  if (url) {
    staleCache.delete(url);
  } else {
    staleCache.clear();
  }
}

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
