import { setTimeout as delay } from 'node:timers/promises';

import { normalizeUrl } from './urls.js';

const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'] as const;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_BACKOFF_MS = 1_000;

export interface FetchPageOptions {
  delayMs?: number;
  retryBackoffMs?: number;
  timeoutMs?: number;
  userAgent?: string;
  verbose?: boolean;
}

export interface FetchPageResult {
  finalUrl: string;
  status: number;
  contentType: string;
  html?: string;
  body?: string;
}

export async function fetchPage(
  url: string,
  options: FetchPageOptions = {},
): Promise<FetchPageResult> {
  if (options.delayMs !== undefined && options.delayMs > 0) {
    await delay(options.delayMs);
  }

  const retryBackoffMs = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;

  let timeoutRetried = false;
  let rateLimitRetried = false;

  while (true) {
    const response = await fetchWithTimeout(url, options);
    const finalUrl = normalizeUrl(response.url);
    const contentType = response.headers.get('content-type') ?? '';

    if (response.status === 429 && !rateLimitRetried) {
      await response.body?.cancel();
      rateLimitRetried = true;
      await delay(retryBackoffMs);
      continue;
    }

    if (response.status >= 400 || !isHtmlContentType(contentType)) {
      const body = await response.text();

      return {
        finalUrl,
        status: response.status,
        contentType,
        body,
      };
    }

    return {
      finalUrl,
      status: response.status,
      contentType,
      html: await response.text(),
    };
  }

  async function fetchWithTimeout(
    targetUrl: string,
    fetchOptions: FetchPageOptions,
  ): Promise<Response> {
    const abortController = new AbortController();
    const timeoutMs = fetchOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      return await fetch(targetUrl, {
        redirect: 'follow',
        headers: {
          'user-agent': fetchOptions.userAgent ?? 'docrawl/0.1.0',
        },
        signal: abortController.signal,
      });
    } catch (error) {
      if (isAbortError(error) && !timeoutRetried) {
        timeoutRetried = true;
        await delay(retryBackoffMs);
        return fetchWithTimeout(targetUrl, fetchOptions);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function isHtmlContentType(contentType: string): boolean {
  const normalizedContentType = contentType.toLowerCase();

  return HTML_CONTENT_TYPES.some((type) => normalizedContentType.includes(type));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
