import picomatch from 'picomatch';

import type { CrawlOptions, CrawlScope } from './types.js';
import { ensureTrailingSlash, normalizeUrl } from './urls.js';

const NON_HTTP_SCHEMES = new Set([
  'javascript:',
  'mailto:',
  'tel:',
  'data:',
  'file:',
  'ftp:',
  'blob:',
]);

const BINARY_EXTENSIONS = new Set([
  '.pdf',
  '.zip',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.mp4',
  '.mp3',
  '.xml',
  '.json',
  '.rss',
  '.txt',
  '.map',
]);

const BUILTIN_SKIP_PATHS = [
  '/search',
  '/tags/',
  '/tag/',
  '/blog/',
  '/changelog/',
  '/releases/',
  '/pricing',
  '/contact',
  '/legal',
  '/_next/',
  '/assets/',
  '/static/',
] as const;

export type FilterDecision =
  | { allowed: true; normalizedUrl: string }
  | { allowed: false; reason: FilterRejectReason };

export type FilterRejectReason =
  | 'fragment_only'
  | 'non_http_scheme'
  | 'out_of_scope'
  | 'excluded'
  | 'builtin_skip'
  | 'binary_extension'
  | 'invalid_url';

export function isNonHttpScheme(input: string): boolean {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === '') {
    return false;
  }

  return [...NON_HTTP_SCHEMES].some((scheme) => trimmed.startsWith(scheme));
}

export function isBinaryExtension(input: string): boolean {
  const pathname = toUrlPathname(input);
  const lowerPathname = pathname.toLowerCase();

  return [...BINARY_EXTENSIONS].some(
    (extension) => lowerPathname === extension || lowerPathname.endsWith(extension),
  );
}

export function isInScope(url: string, scope: CrawlScope): boolean {
  const normalizedUrl = normalizeUrl(url);
  const normalizedBaseUrl = normalizeUrl(scope.baseUrl);

  const target = new URL(normalizedUrl);
  const base = new URL(normalizedBaseUrl);

  if (target.hostname !== base.hostname) {
    return false;
  }

  if (scope.mode === 'domain') {
    return true;
  }

  const basePath = ensureTrailingSlash(base.pathname);
  const targetPath = ensureTrailingSlash(target.pathname);

  return targetPath.startsWith(basePath);
}

export function matchesBuiltinSkipPatterns(input: string): boolean {
  const pathname = ensureTrailingSlash(toUrlPathname(input).toLowerCase());

  return BUILTIN_SKIP_PATHS.some((pattern) => {
    const normalizedPattern = ensureTrailingSlash(pattern);

    return pathname.includes(normalizedPattern);
  });
}

export function applyFilters(
  input: string,
  scope: CrawlScope,
  options: Pick<CrawlOptions, 'include' | 'exclude'>,
  base?: string,
): FilterDecision {
  const trimmed = input.trim();

  if (trimmed.startsWith('#')) {
    return { allowed: false, reason: 'fragment_only' };
  }

  if (isNonHttpScheme(trimmed)) {
    return { allowed: false, reason: 'non_http_scheme' };
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(trimmed, base);
  } catch {
    return { allowed: false, reason: 'invalid_url' };
  }

  if (!isInScope(normalizedUrl, scope)) {
    return { allowed: false, reason: 'out_of_scope' };
  }

  if (matchesPatterns(normalizedUrl, options.exclude)) {
    return { allowed: false, reason: 'excluded' };
  }

  if (matchesPatterns(normalizedUrl, options.include)) {
    if (isBinaryExtension(normalizedUrl)) {
      return { allowed: false, reason: 'binary_extension' };
    }

    return { allowed: true, normalizedUrl };
  }

  if (matchesBuiltinSkipPatterns(normalizedUrl)) {
    return { allowed: false, reason: 'builtin_skip' };
  }

  if (isBinaryExtension(normalizedUrl)) {
    return { allowed: false, reason: 'binary_extension' };
  }

  return { allowed: true, normalizedUrl };
}

function matchesPatterns(url: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }

  const target = new URL(url);
  const candidates = [url, target.pathname, `${target.pathname}${target.search}`];

  return patterns.some((pattern) => candidates.some((candidate) => picomatch.isMatch(candidate, pattern)));
}

function toUrlPathname(input: string): string {
  try {
    return new URL(input).pathname;
  } catch {
    return input;
  }
}
