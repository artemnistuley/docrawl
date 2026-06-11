import path from 'node:path';

import { discoverLinks } from './discover.js';
import { toErrorMessage } from './errors.js';
import { extractPage } from './extract.js';
import { fetchPage, type FetchPageResult } from './fetch.js';
import { applyFilters } from './filters.js';
import {
  attachContentHash,
  ensureOutputDir,
  writeManifest,
  writePageFile,
  writeSingleFile,
  type SuccessfulPageResult,
} from './output.js';
import { CrawlQueue } from './queue.js';
import { discoverSitemap } from './sitemap.js';
import type { CrawlManifest, CrawlOptions, CrawlPageResult, CrawlScope } from './types.js';
import { deriveScope, normalizeUrl, resolveCollision, urlToOutputPath } from './urls.js';

interface CrawlRuntime {
  queue: CrawlQueue;
  results: CrawlPageResult[];
  reservedPages: number;
  inFlight: number;
  interrupted: boolean;
  forcedExit: boolean;
  queueWaiters: Array<() => void>;
}

interface CrawlContext {
  options: CrawlOptions;
  scope: CrawlScope;
  seedUrl: string;
  maxDepth?: number;
  runtime: CrawlRuntime;
}

interface ProcessPageContext {
  requestedUrl: string;
  depth: number;
  fetchResult: FetchPageResult;
}

export async function crawl(seedUrl: string, options: CrawlOptions): Promise<CrawlManifest> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const normalizedSeedUrl = normalizeUrl(seedUrl);
  const scope = deriveScope(normalizedSeedUrl, options.domain);

  const context: CrawlContext = {
    options,
    scope,
    seedUrl: normalizedSeedUrl,
    runtime: {
      queue: new CrawlQueue(),
      results: [],
      reservedPages: 0,
      inFlight: 0,
      interrupted: false,
      forcedExit: false,
      queueWaiters: [],
    },
  };

  if (options.depth !== undefined) {
    context.maxDepth = options.depth;
  }

  const handleSigint = createSigintHandler(context.runtime);
  process.on('SIGINT', handleSigint);

  context.runtime.queue.enqueue(normalizedSeedUrl, 0);

  try {
    await prepareOutput(context);
    await seedQueueFromSitemap(context);
    await runWorkers(context);

    const finalizedResults = finalizeResults(context.runtime.results, scope.baseUrl);
    await writeOutputs(finalizedResults, normalizedSeedUrl, options);

    const manifest = buildManifest({
      seedUrl: normalizedSeedUrl,
      scope,
      startedAt,
      finishedAt: new Date().toISOString(),
      results: finalizedResults,
      durationMs: Date.now() - startTime,
    });

    await writeManifest(manifest, getManifestPath(options.output, options.singleFile));
    logSummary(manifest);

    return manifest;
  } finally {
    process.removeListener('SIGINT', handleSigint);
  }
}

function createSigintHandler(runtime: CrawlRuntime): () => void {
  return () => {
    if (!runtime.interrupted) {
      runtime.interrupted = true;
      console.log('Received Ctrl+C, finishing in-flight work and writing partial results...');
      notifyQueueStateChanged(runtime);
      return;
    }

    if (!runtime.forcedExit) {
      runtime.forcedExit = true;
      console.log('Received Ctrl+C again, exiting immediately.');
      process.exit(130);
    }
  };
}

async function prepareOutput(context: CrawlContext): Promise<void> {
  if (!context.options.singleFile) {
    await ensureOutputDir(context.options.output);
  }
}

async function seedQueueFromSitemap(context: CrawlContext): Promise<void> {
  if (!context.options.sitemap || context.runtime.interrupted) {
    return;
  }

  const sitemapUrls = await discoverSitemap(context.seedUrl, context.scope, {
    include: context.options.include,
    exclude: context.options.exclude,
    verbose: context.options.verbose,
    fetchDelayMs: context.options.delay,
  });

  if (sitemapUrls === null) {
    return;
  }

  for (const sitemapUrl of sitemapUrls) {
    const sitemapDepth = inferDepthFromScope(sitemapUrl, context.scope);
    if (context.maxDepth !== undefined && sitemapDepth > context.maxDepth) {
      continue;
    }

    context.runtime.queue.enqueue(sitemapUrl, sitemapDepth);
  }

  notifyQueueStateChanged(context.runtime);
}

async function runWorkers(context: CrawlContext): Promise<void> {
  const workerCount = Math.max(1, context.options.concurrency);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker(context)));
}

async function runWorker(context: CrawlContext): Promise<void> {
  while (true) {
    if (shouldStopWorker(context)) {
      return;
    }

    const next = context.runtime.queue.dequeue();
    if (next === null) {
      if (isWorkDrained(context.runtime)) {
        return;
      }

      await waitForQueueStateChange(context.runtime);
      continue;
    }

    if (context.maxDepth !== undefined && next.depth > context.maxDepth) {
      continue;
    }

    context.runtime.reservedPages += 1;
    logVerbose(
      context.options.verbose,
      `[queue] ${context.runtime.reservedPages}/${context.options.maxPages} depth=${next.depth} ${next.url}`,
    );
    context.runtime.queue.markVisited(next.url);
    context.runtime.inFlight += 1;

    try {
      const pageResult = await processUrl(context, next.url, next.depth);
      context.runtime.results.push(pageResult);
      logProgress(context, pageResult);
      logVerbose(
        context.options.verbose,
        `[done] ${context.runtime.results.length}/${context.options.maxPages} ${pageResult.status} ${pageResult.finalUrl}`,
      );
    } finally {
      context.runtime.inFlight -= 1;
      notifyQueueStateChanged(context.runtime);
    }
  }
}

function shouldStopWorker(context: CrawlContext): boolean {
  return context.runtime.interrupted || context.runtime.reservedPages >= context.options.maxPages;
}

function isWorkDrained(runtime: CrawlRuntime): boolean {
  return runtime.queue.isEmpty() && runtime.inFlight === 0;
}

async function processUrl(
  context: CrawlContext,
  requestedUrl: string,
  depth: number,
): Promise<CrawlPageResult> {
  try {
    const fetchResult = await fetchPage(requestedUrl, {
      delayMs: context.options.delay,
    });
    logVerbose(
      context.options.verbose,
      `[fetch] ${fetchResult.status} ${fetchResult.finalUrl} (${fetchResult.contentType || 'unknown'})`,
    );

    const processContext: ProcessPageContext = {
      requestedUrl,
      depth,
      fetchResult,
    };

    if (context.runtime.queue.hasVisitedFinalUrl(fetchResult.finalUrl)) {
      return buildSkippedDuplicateResult(processContext);
    }

    context.runtime.queue.markFinalVisited(fetchResult.finalUrl);

    if (fetchResult.status >= 400) {
      return buildHttpErrorResult(processContext);
    }

    if (fetchResult.html === undefined) {
      return buildNonHtmlResult(processContext);
    }

    enqueueDiscoveredLinks(context, fetchResult.html, fetchResult.finalUrl, depth);

    return extractFetchedPage(context, processContext);
  } catch (error) {
    return {
      url: requestedUrl,
      finalUrl: requestedUrl,
      depth,
      status: 'error_network',
      error: toErrorMessage(error),
      crawledAt: new Date().toISOString(),
    };
  }
}

function buildSkippedDuplicateResult(context: ProcessPageContext): CrawlPageResult {
  return {
    url: context.requestedUrl,
    finalUrl: context.fetchResult.finalUrl,
    depth: context.depth,
    status: 'skipped_filtered',
    httpStatus: context.fetchResult.status,
    error: 'duplicate_final_url',
    crawledAt: new Date().toISOString(),
  };
}

function buildHttpErrorResult(context: ProcessPageContext): CrawlPageResult {
  return {
    url: context.requestedUrl,
    finalUrl: context.fetchResult.finalUrl,
    depth: context.depth,
    status: 'error_http',
    httpStatus: context.fetchResult.status,
    error: `HTTP ${context.fetchResult.status}`,
    crawledAt: new Date().toISOString(),
  };
}

function buildNonHtmlResult(context: ProcessPageContext): CrawlPageResult {
  return {
    url: context.requestedUrl,
    finalUrl: context.fetchResult.finalUrl,
    depth: context.depth,
    status: 'skipped_filtered',
    httpStatus: context.fetchResult.status,
    error: `non_html:${context.fetchResult.contentType || 'unknown'}`,
    crawledAt: new Date().toISOString(),
  };
}

async function extractFetchedPage(
  context: CrawlContext,
  processContext: ProcessPageContext,
): Promise<CrawlPageResult> {
  const extractOptions: {
    depth: number;
    lang?: string;
    scope: CrawlScope;
  } = {
    depth: processContext.depth,
    scope: context.scope,
  };

  if (context.options.lang !== undefined) {
    extractOptions.lang = context.options.lang;
  }

  const extracted = await extractPage(
    processContext.fetchResult.html as string,
    processContext.fetchResult.finalUrl,
    extractOptions,
  );

  return attachContentHash({
    ...extracted,
    url: processContext.requestedUrl,
    finalUrl: processContext.fetchResult.finalUrl,
    httpStatus: processContext.fetchResult.status,
  });
}

function enqueueDiscoveredLinks(
  context: CrawlContext,
  html: string,
  baseUrl: string,
  depth: number,
): void {
  const nextDepth = depth + 1;
  if (context.maxDepth !== undefined && nextDepth > context.maxDepth) {
    return;
  }

  let enqueuedCount = 0;
  for (const discoveredUrl of discoverLinks(html, baseUrl)) {
    const decision = applyFilters(discoveredUrl, context.scope, context.options, baseUrl);
    if (!decision.allowed) {
      continue;
    }

    if (context.runtime.queue.enqueue(decision.normalizedUrl, nextDepth)) {
      enqueuedCount += 1;
    }
  }

  if (enqueuedCount > 0) {
    notifyQueueStateChanged(context.runtime);
    logVerbose(
      context.options.verbose,
      `[discover] queued ${enqueuedCount} new link(s) from ${baseUrl}`,
    );
  }
}

function waitForQueueStateChange(runtime: CrawlRuntime): Promise<void> {
  return new Promise((resolve) => {
    runtime.queueWaiters.push(resolve);
  });
}

function notifyQueueStateChanged(runtime: CrawlRuntime): void {
  if (runtime.queueWaiters.length === 0) {
    return;
  }

  const waiters = runtime.queueWaiters;
  runtime.queueWaiters = [];
  for (const resolve of waiters) {
    resolve();
  }
}

function finalizeResults(results: CrawlPageResult[], baseUrl: string): CrawlPageResult[] {
  const assignedPaths = new Map<string, string>();
  const pathAssignments = new Map<string, string>();

  const successfulResults = results
    .filter((result) => result.status === 'success')
    .slice()
    .sort((left, right) => left.url.localeCompare(right.url));

  for (const result of successfulResults) {
    const basePath = urlToOutputPath(result.finalUrl, baseUrl);
    const resolvedPath = resolveCollision(basePath, result.finalUrl, assignedPaths);
    assignedPaths.set(resolvedPath, result.finalUrl);
    pathAssignments.set(result.url, resolvedPath);
  }

  return results.map((result) => {
    const outputPath = pathAssignments.get(result.url);
    if (outputPath === undefined) {
      return result;
    }

    return {
      ...result,
      outputPath,
    };
  });
}

async function writeOutputs(
  results: CrawlPageResult[],
  seedUrl: string,
  options: CrawlOptions,
): Promise<void> {
  const successfulResults = getSuccessfulPageResults(results);

  if (options.singleFile) {
    await writeSingleFile(successfulResults, options.output, seedUrl);
    return;
  }

  await Promise.all(successfulResults.map((result) => writePageFile(result, options.output)));
}

function getSuccessfulPageResults(results: CrawlPageResult[]): Array<SuccessfulPageResult & { outputPath: string }> {
  return results.filter(
    (result): result is SuccessfulPageResult & { outputPath: string } =>
      result.status === 'success' &&
      result.content !== undefined &&
      result.outputPath !== undefined,
  );
}

function buildManifest(input: {
  seedUrl: string;
  scope: CrawlScope;
  startedAt: string;
  finishedAt: string;
  results: CrawlPageResult[];
  durationMs: number;
}): CrawlManifest {
  return {
    seedUrl: input.seedUrl,
    scope: input.scope,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    results: input.results.map(stripPageContent),
    summary: buildSummary(input.results, input.durationMs),
  };
}

function buildSummary(results: CrawlPageResult[], durationMs: number) {
  const summary = {
    total: results.length,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    durationMs,
  };

  for (const result of results) {
    if (result.status === 'success') {
      summary.succeeded += 1;
    } else if (
      result.status === 'error_http' ||
      result.status === 'error_network' ||
      result.status === 'error_parse'
    ) {
      summary.failed += 1;
    } else {
      summary.skipped += 1;
    }
  }

  return summary;
}

function getManifestPath(output: string, singleFile: boolean): string {
  if (!singleFile) {
    return path.join(output, 'manifest.json');
  }

  const parsed = path.parse(output);
  const manifestFileName = parsed.ext === ''
    ? `${parsed.name || 'output'}.manifest.json`
    : `${parsed.name}.manifest.json`;

  return path.join(parsed.dir, manifestFileName);
}

function inferDepthFromScope(url: string, scope: CrawlScope): number {
  const normalizedBaseUrl = normalizeUrl(scope.baseUrl);
  const base = new URL(normalizedBaseUrl);
  const target = new URL(normalizeUrl(url));

  const baseSegments = base.pathname.split('/').filter(Boolean);
  const targetSegments = target.pathname.split('/').filter(Boolean);

  return Math.max(0, targetSegments.length - baseSegments.length);
}

function stripPageContent(result: CrawlPageResult): CrawlPageResult {
  const { content, ...rest } = result;
  return rest;
}

function logSummary(manifest: CrawlManifest): void {
  const durationSeconds = Math.round(manifest.summary.durationMs / 1000);
  console.log(`Crawled ${manifest.summary.total} pages in ${durationSeconds}s`);
  console.log(`  success: ${manifest.summary.succeeded}`);
  console.log(`  skipped: ${manifest.summary.skipped}`);
  console.log(`  failed: ${manifest.summary.failed}`);
}

function logVerbose(enabled: boolean, message: string): void {
  if (!enabled) {
    return;
  }

  console.log(message);
}

function logProgress(context: CrawlContext, result: CrawlPageResult): void {
  if (context.options.verbose) {
    return;
  }

  console.log(`[${context.runtime.results.length}/${context.options.maxPages}] ${result.status} ${result.finalUrl}`);
}
