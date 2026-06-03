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
