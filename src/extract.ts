import { parseHTML } from 'linkedom';
import { Defuddle } from 'defuddle/node';

import { toErrorMessage } from './errors.js';
import { isInScope } from './filters.js';
import type { CrawlPageResult, CrawlScope } from './types.js';
import { normalizeUrl } from './urls.js';

const DEFAULT_MIN_WORD_COUNT = 10;

export interface ExtractPageOptions {
  depth: number;
  lang?: string;
  minWordCount?: number;
  scope?: CrawlScope;
  verbose?: boolean;
}

export async function extractPage(
  html: string,
  url: string,
  options: ExtractPageOptions,
): Promise<CrawlPageResult> {
  const normalizedUrl = normalizeUrl(url);
  const crawledAt = new Date().toISOString();

  try {
    const { document } = parseHTML(html);
    sanitizeProtocolRelativeUrls(document, normalizedUrl);
    const canonicalUrl = extractCanonicalUrl(document, normalizedUrl, options.scope);
    const defuddleOptions: {
      markdown: true;
      useAsync: false;
      language?: string;
    } = {
      markdown: true,
      useAsync: false,
    };

    if (options.lang !== undefined) {
      defuddleOptions.language = options.lang;
    }

    const result = await Defuddle(document, normalizedUrl, defuddleOptions);

    const content = result.content.trim();
    const wordCount = countWords(content);
    const minWordCount = options.minWordCount ?? DEFAULT_MIN_WORD_COUNT;

    const pageResult: CrawlPageResult = {
      url: normalizedUrl,
      finalUrl: normalizedUrl,
      content,
      depth: options.depth,
      status: wordCount >= minWordCount ? 'success' : 'skipped_empty',
      wordCount,
      crawledAt,
    };

    if (canonicalUrl !== undefined) {
      pageResult.canonicalUrl = canonicalUrl;
    }

    if (result.title) {
      pageResult.title = result.title;
    }

    return pageResult;
  } catch (error) {
    return {
      url: normalizedUrl,
      finalUrl: normalizedUrl,
      depth: options.depth,
      status: 'error_parse',
      error: toErrorMessage(error),
      crawledAt,
    };
  }
}

function extractCanonicalUrl(
  document: Document,
  pageUrl: string,
  scope?: CrawlScope,
): string | undefined {
  const canonicalHref = document
    .querySelector('link[rel="canonical"]')
    ?.getAttribute('href')
    ?.trim();

  if (!canonicalHref) {
    return undefined;
  }

  try {
    const canonicalUrl = normalizeUrl(canonicalHref, pageUrl);

    if (scope !== undefined && !isInScope(canonicalUrl, scope)) {
      return undefined;
    }

    return canonicalUrl;
  } catch {
    return undefined;
  }
}

function countWords(content: string): number {
  const words = content.match(/\S+/g);
  return words?.length ?? 0;
}

const PROTOCOL_RELATIVE_PREFIX = '//';

const META_URL_SELECTORS = [
  { selector: 'meta[property="og:url"]', attribute: 'content' },
  { selector: 'meta[property="twitter:url"]', attribute: 'content' },
  { selector: 'link[rel="canonical"]', attribute: 'href' },
  { selector: 'link[rel="alternate"]', attribute: 'href' },
] as const;

export function sanitizeProtocolRelativeUrls(document: Document, pageUrl: string): void {
  for (const { selector, attribute } of META_URL_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) {
      const value = element.getAttribute(attribute);
      if (value?.startsWith(PROTOCOL_RELATIVE_PREFIX)) {
        try {
          element.setAttribute(attribute, new URL(value, pageUrl).href);
        } catch {
          // leave malformed URLs unchanged
        }
      }
    }
  }

  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const text = script.textContent;
    if (!text?.includes(PROTOCOL_RELATIVE_PREFIX)) {
      continue;
    }

    try {
      const data = JSON.parse(text);
      if (typeof data.url === 'string' && data.url.startsWith(PROTOCOL_RELATIVE_PREFIX)) {
        data.url = new URL(data.url, pageUrl).href;
        script.textContent = JSON.stringify(data);
      }
    } catch {
      // leave unparseable JSON-LD unchanged
    }
  }
}
