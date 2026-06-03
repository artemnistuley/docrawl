import { XMLParser } from 'fast-xml-parser';

import { applyFilters } from './filters.js';
import { fetchPage } from './fetch.js';
import type { CrawlOptions, CrawlScope } from './types.js';

const SITEMAP_CANDIDATE_PATHS = ['/sitemap.xml', '/sitemap_index.xml'] as const;

export interface DiscoverSitemapOptions extends Pick<CrawlOptions, 'include' | 'exclude' | 'verbose'> {
  fetchDelayMs?: number;
  retryBackoffMs?: number;
  timeoutMs?: number;
  userAgent?: string;
}

interface UrlSetNode {
  url?: UrlNode | UrlNode[];
}

interface UrlNode {
  loc?: string;
}

interface SitemapIndexNode {
  sitemap?: SitemapNode | SitemapNode[];
}

interface SitemapNode {
  loc?: string;
}

interface SitemapDocument {
  urlset?: UrlSetNode;
  sitemapindex?: SitemapIndexNode;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

export async function discoverSitemap(
  seedUrl: string,
  scope: CrawlScope,
  options: DiscoverSitemapOptions,
): Promise<string[] | null> {
  const sitemapRoot = new URL(seedUrl).origin;
  const visitedSitemaps = new Set<string>();

  for (const candidatePath of SITEMAP_CANDIDATE_PATHS) {
    const sitemapUrl = `${sitemapRoot}${candidatePath}`;
    const discoveredUrls = await collectSitemapUrls(sitemapUrl, scope, options, visitedSitemaps);

    if (discoveredUrls !== null && discoveredUrls.size > 0) {
      return [...discoveredUrls];
    }
  }

  return null;
}

async function collectSitemapUrls(
  sitemapUrl: string,
  scope: CrawlScope,
  options: DiscoverSitemapOptions,
  visitedSitemaps: Set<string>,
): Promise<Set<string> | null> {
  if (visitedSitemaps.has(sitemapUrl)) {
    return new Set<string>();
  }

  visitedSitemaps.add(sitemapUrl);

  const response = await fetchSitemapDocument(sitemapUrl, options);
  if (response === null) {
    return null;
  }

  const document = parseSitemap(response);
  const urls = new Set<string>();

  for (const pageUrl of getUrlEntries(document)) {
    const decision = applyFilters(pageUrl, scope, options);
    if (decision.allowed) {
      urls.add(decision.normalizedUrl);
    }
  }

  for (const nestedSitemapUrl of getNestedSitemapEntries(document)) {
    const nestedUrls = await collectSitemapUrls(nestedSitemapUrl, scope, options, visitedSitemaps);

    if (nestedUrls === null) {
      continue;
    }

    for (const discoveredUrl of nestedUrls) {
      urls.add(discoveredUrl);
    }
  }

  return urls;
}

async function fetchSitemapDocument(
  sitemapUrl: string,
  options: DiscoverSitemapOptions,
): Promise<string | null> {
  try {
    const fetchOptions: {
      delayMs?: number;
      retryBackoffMs?: number;
      timeoutMs?: number;
      userAgent?: string;
      verbose: boolean;
    } = {
      verbose: options.verbose,
    };

    if (options.fetchDelayMs !== undefined) {
      fetchOptions.delayMs = options.fetchDelayMs;
    }

    if (options.retryBackoffMs !== undefined) {
      fetchOptions.retryBackoffMs = options.retryBackoffMs;
    }

    if (options.timeoutMs !== undefined) {
      fetchOptions.timeoutMs = options.timeoutMs;
    }

    if (options.userAgent !== undefined) {
      fetchOptions.userAgent = options.userAgent;
    }

    const response = await fetchPage(sitemapUrl, fetchOptions);

    if (response.status >= 400) {
      return null;
    }

    return response.body ?? response.html ?? null;
  } catch {
    return null;
  }
}

function parseSitemap(xml: string): SitemapDocument {
  return xmlParser.parse(xml) as SitemapDocument;
}

function getUrlEntries(document: SitemapDocument): string[] {
  return toArray(document.urlset?.url)
    .map((entry) => entry.loc?.trim())
    .filter((value): value is string => value !== undefined && value !== '');
}

function getNestedSitemapEntries(document: SitemapDocument): string[] {
  return toArray(document.sitemapindex?.sitemap)
    .map((entry) => entry.loc?.trim())
    .filter((value): value is string => value !== undefined && value !== '');
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}
