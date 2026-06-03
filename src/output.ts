import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { CrawlManifest, CrawlPageResult } from './types.js';

export interface SuccessfulPageResult extends CrawlPageResult {
  content: string;
}

export async function ensureOutputDir(targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true });
}

export async function writePageFile(result: CrawlPageResult, outputDir: string): Promise<string> {
  if (result.outputPath === undefined) {
    throw new Error('Cannot write page file without outputPath');
  }

  const absolutePath = path.join(outputDir, result.outputPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, renderPageMarkdown(result), 'utf8');

  return absolutePath;
}

export async function writeSingleFile(
  results: CrawlPageResult[],
  outputPath: string,
  seedUrl: string,
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, renderSingleFileMarkdown(results, seedUrl), 'utf8');
}

export async function writeManifest(manifest: CrawlManifest, outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function attachContentHash(result: CrawlPageResult): CrawlPageResult {
  if (result.content === undefined) {
    return result;
  }

  return {
    ...result,
    contentHash: createHash('sha256').update(result.content).digest('hex'),
  };
}

export function renderPageMarkdown(result: CrawlPageResult): string {
  const frontmatterLines = [
    '---',
    `title: ${serializeFrontmatterValue(result.title ?? deriveFallbackTitle(result.url))}`,
    `sourceUrl: ${serializeFrontmatterValue(result.url)}`,
    `finalUrl: ${serializeFrontmatterValue(result.finalUrl)}`,
    `crawledAt: ${serializeFrontmatterValue(result.crawledAt)}`,
    `depth: ${result.depth}`,
  ];

  if (result.canonicalUrl !== undefined) {
    frontmatterLines.push(`canonicalUrl: ${serializeFrontmatterValue(result.canonicalUrl)}`);
  }

  if (result.wordCount !== undefined) {
    frontmatterLines.push(`wordCount: ${result.wordCount}`);
  }

  if (result.contentHash !== undefined) {
    frontmatterLines.push(`contentHash: ${serializeFrontmatterValue(result.contentHash)}`);
  }

  frontmatterLines.push('---', '');

  const content = result.content?.trim() ?? '';
  return `${frontmatterLines.join('\n')}${content}${content === '' ? '' : '\n'}`;
}

export function renderSingleFileMarkdown(results: CrawlPageResult[], seedUrl: string): string {
  const successfulResults = getSuccessfulPageResults(results);
  const headingAnchors = buildHeadingAnchors(successfulResults);

  const crawledAt = successfulResults[0]?.crawledAt ?? new Date().toISOString();
  const title = new URL(seedUrl).hostname;

  const lines: string[] = [
    `# ${title}`,
    '',
    `<!-- crawledAt: ${crawledAt} -->`,
    `<!-- pages: ${successfulResults.length} -->`,
    '',
    '## Table of contents',
    '',
  ];

  for (const result of successfulResults) {
    const heading = result.title ?? deriveFallbackTitle(result.url);
    lines.push(`- [${heading}](#${headingAnchors.get(result.url) ?? toSlug(heading)})`);
  }

  for (const result of successfulResults) {
    const heading = result.title ?? deriveFallbackTitle(result.url);
    const anchor = headingAnchors.get(result.url) ?? toSlug(heading);
    lines.push('', '---', '', `<a id="${anchor}"></a>`, '', `## ${heading}`, `Source: ${result.url}`, '', result.content.trim());
  }

  lines.push('');
  return lines.join('\n');
}

function getSuccessfulPageResults(results: CrawlPageResult[]): SuccessfulPageResult[] {
  return results.filter(
    (result): result is SuccessfulPageResult =>
      result.status === 'success' && result.content !== undefined,
  );
}

function deriveFallbackTitle(url: string): string {
  const { pathname, hostname } = new URL(url);
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    return hostname;
  }

  const lastSegment = segments.at(-1) ?? hostname;
  return decodeURIComponent(lastSegment).replace(/[-_]+/g, ' ');
}

function serializeFrontmatterValue(value: string): string {
  return JSON.stringify(value);
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function buildHeadingAnchors(
  results: SuccessfulPageResult[],
): Map<string, string> {
  const seenCounts = new Map<string, number>();
  const anchors = new Map<string, string>();

  for (const result of results) {
    const heading = result.title ?? deriveFallbackTitle(result.url);
    const baseSlug = toSlug(heading);
    const seenCount = seenCounts.get(baseSlug) ?? 0;
    const anchor = seenCount === 0 ? baseSlug : `${baseSlug}-${seenCount + 1}`;

    seenCounts.set(baseSlug, seenCount + 1);
    anchors.set(result.url, anchor);
  }

  return anchors;
}
