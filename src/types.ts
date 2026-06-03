export type CrawlScopeMode = 'path' | 'domain';

export type CrawlPageStatus =
  | 'success'
  | 'skipped_empty'
  | 'skipped_filtered'
  | 'error_http'
  | 'error_network'
  | 'error_parse';

export interface CrawlScope {
  baseUrl: string;
  mode: CrawlScopeMode;
}

export interface CrawlOptions {
  output: string;
  singleFile: boolean;
  domain: boolean;
  depth?: number;
  maxPages: number;
  concurrency: number;
  delay: number;
  lang?: string;
  sitemap: boolean;
  include: string[];
  exclude: string[];
  verbose: boolean;
}

export interface CrawlPageResult {
  url: string;
  finalUrl: string;
  canonicalUrl?: string;
  title?: string;
  content?: string;
  depth: number;
  status: CrawlPageStatus;
  httpStatus?: number;
  wordCount?: number;
  outputPath?: string;
  contentHash?: string;
  error?: string;
  crawledAt: string;
}

export interface CrawlManifestSummary {
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  durationMs: number;
}

export interface CrawlManifest {
  seedUrl: string;
  scope: CrawlScope;
  startedAt: string;
  finishedAt: string;
  results: CrawlPageResult[];
  summary: CrawlManifestSummary;
}
