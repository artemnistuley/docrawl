import { createHash } from 'node:crypto';
import path from 'node:path';

import type { CrawlScope } from './types.js';

const TRACKING_QUERY_PARAM_PATTERN = /^utm_/i;
const DEFAULT_PORTS = new Map<string, string>([
  ['http:', '80'],
  ['https:', '443'],
]);

export function normalizeUrl(input: string, base?: string): string {
  const url = new URL(input, base);

  url.hash = '';
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  const defaultPort = DEFAULT_PORTS.get(url.protocol);
  if (url.port === defaultPort) {
    url.port = '';
  }

  url.pathname = normalizePathname(url.pathname);

  const normalizedQueryEntries = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_QUERY_PARAM_PATTERN.test(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }

      return leftKey.localeCompare(rightKey);
    });

  url.search = '';
  for (const [key, value] of normalizedQueryEntries) {
    url.searchParams.append(key, value);
  }

  return url.toString();
}

export function normalizeTrailingSlash(input: string, base?: string): string {
  const url = new URL(input, base);

  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

export function deriveScope(seedUrl: string, domainMode: boolean): CrawlScope {
  const normalizedSeedUrl = normalizeUrl(seedUrl);
  const seed = new URL(normalizedSeedUrl);

  if (domainMode) {
    return {
      baseUrl: `${seed.origin}/`,
      mode: 'domain',
    };
  }

  const basePath = deriveBasePath(seed.pathname);

  return {
    baseUrl: `${seed.origin}${basePath}`,
    mode: 'path',
  };
}

export function ensureTrailingSlash(pathname: string): string {
  if (pathname === '' || pathname === '/') {
    return '/';
  }

  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

export function urlToOutputPath(url: string, baseUrl: string): string {
  const normalizedUrl = normalizeUrl(url);
  const normalizedBaseUrl = normalizeUrl(baseUrl);

  const target = new URL(normalizedUrl);
  const base = new URL(normalizedBaseUrl);

  const targetPath = stripTrailingSlash(target.pathname);
  const basePath = ensureTrailingSlash(base.pathname);
  const baseSegments = pathnameToSegments(stripTrailingSlash(base.pathname));

  let relativePath = targetPath;
  if (basePath !== '/' && targetPath.startsWith(basePath.slice(0, -1))) {
    relativePath = targetPath.slice(basePath.length - 1);
  }

  const relativeSegments = pathnameToSegments(relativePath);

  if (relativeSegments.length === 0) {
    return toPosixPath([...baseSegments, 'index.md']);
  }

  return toPosixPath([...baseSegments, `${relativeSegments.join('/')}.md`]);
}

export function resolveCollision(
  outputPath: string,
  normalizedUrl: string,
  existingPaths: ReadonlyMap<string, string>,
): string {
  const claimedBy = existingPaths.get(outputPath);

  if (claimedBy === undefined || claimedBy === normalizedUrl) {
    return outputPath;
  }

  const parsedPath = path.posix.parse(outputPath);
  const suffix = shortHash(normalizedUrl);

  return path.posix.join(parsedPath.dir, `${parsedPath.name}--${suffix}${parsedPath.ext}`);
}

function normalizePathname(pathname: string): string {
  if (pathname === '') {
    return '/';
  }

  const collapsed = pathname.replace(/\/{2,}/g, '/');

  if (collapsed === '/') {
    return '/';
  }

  return stripTrailingSlash(collapsed);
}

function deriveBasePath(pathname: string): string {
  if (pathname === '/' || pathname === '') {
    return '/';
  }

  const normalizedPath = ensureTrailingSlash(pathname);
  const lastSlashIndex = normalizedPath.lastIndexOf('/', normalizedPath.length - 2);

  if (lastSlashIndex <= 0) {
    return '/';
  }

  return normalizedPath.slice(0, lastSlashIndex + 1);
}

function stripTrailingSlash(pathname: string): string {
  if (pathname === '/' || pathname === '') {
    return '/';
  }

  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function pathnameToSegments(pathname: string): string[] {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => sanitizePathSegment(segment));
}

function sanitizePathSegment(segment: string): string {
  const sanitized = decodeURIComponent(segment)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitized || 'page';
}

function toPosixPath(segments: string[]): string {
  return segments.join('/');
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 6);
}
