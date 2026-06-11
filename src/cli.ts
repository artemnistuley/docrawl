#!/usr/bin/env node

import { Command } from 'commander';

import { crawl } from './crawl.js';
import { toErrorMessage } from './errors.js';
import { extractPage } from './extract.js';
import { fetchPage } from './fetch.js';
import type { CrawlOptions } from './types.js';
import { normalizeUrl } from './urls.js';

const VERSION = '0.1.0';

interface CrawlCommandOptions {
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

interface ParseCommandOptions {
  json: boolean;
  lang?: string;
}

const program = new Command();

program
  .name('docrawl')
  .description('Crawl documentation sites into Markdown')
  .version(VERSION);

program
  .command('crawl')
  .description('Crawl a documentation site and write Markdown output')
  .argument('<url>', 'Seed documentation URL')
  .option('-o, --output <path>', 'Output directory or file path', './output')
  .option('-s, --single-file', 'Merge all pages into one Markdown file', false)
  .option('--domain', 'Crawl the whole hostname, not just the seed path', false)
  .option('--depth <n>', 'Maximum crawl depth', parseIntegerOption)
  .option('--max-pages <n>', 'Maximum pages to process', parseIntegerOption, 500)
  .option('--concurrency <n>', 'Concurrent requests', parseIntegerOption, 3)
  .option('--delay <ms>', 'Delay between requests per worker', parseIntegerOption, 500)
  .option('--lang <code>', 'Preferred language for extraction, BCP 47')
  .option('--no-sitemap', 'Disable sitemap discovery')
  .option('--include <glob>', 'Include URL glob pattern', collectRepeatableOption, [])
  .option('--exclude <glob>', 'Exclude URL glob pattern', collectRepeatableOption, [])
  .option('--verbose', 'Verbose logging', false)
  .action(async (url: string, commandOptions: CrawlCommandOptions) => {
    validateHttpUrl(url);
    validateNonNegativeNumber(commandOptions.maxPages, 'max-pages');
    validateNonNegativeNumber(commandOptions.delay, 'delay');
    validatePositiveNumber(commandOptions.concurrency, 'concurrency');

    if (commandOptions.depth !== undefined) {
      validateNonNegativeNumber(commandOptions.depth, 'depth');
    }

    const options: CrawlOptions = {
      output: commandOptions.output,
      singleFile: commandOptions.singleFile,
      domain: commandOptions.domain,
      maxPages: commandOptions.maxPages,
      concurrency: commandOptions.concurrency,
      delay: commandOptions.delay,
      sitemap: commandOptions.sitemap,
      include: commandOptions.include,
      exclude: commandOptions.exclude,
      verbose: commandOptions.verbose,
    };

    if (commandOptions.depth !== undefined) {
      options.depth = commandOptions.depth;
    }

    if (commandOptions.lang !== undefined) {
      options.lang = commandOptions.lang;
    }

    await crawl(url, options);
  });

program
  .command('parse')
  .description('Extract a single page into Markdown or JSON')
  .argument('<url>', 'Single page URL to extract')
  .option('-j, --json', 'Output full JSON response', false)
  .option('--lang <code>', 'Preferred language for extraction, BCP 47')
  .action(async (url: string, commandOptions: ParseCommandOptions) => {
    validateHttpUrl(url);

    const fetchResult = await fetchPage(url);

    if (fetchResult.status >= 400) {
      throw new Error(`HTTP ${fetchResult.status}`);
    }

    if (fetchResult.html === undefined) {
      throw new Error(`Expected HTML content, received: ${fetchResult.contentType || 'unknown'}`);
    }

    const extractOptions: {
      depth: number;
      lang?: string;
    } = {
      depth: 0,
    };

    if (commandOptions.lang !== undefined) {
      extractOptions.lang = commandOptions.lang;
    }

    const result = await extractPage(fetchResult.html, fetchResult.finalUrl, extractOptions);

    if (commandOptions.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (result.content !== undefined) {
      process.stdout.write(`${result.content}\n`);
      return;
    }

    process.stdout.write('\n');
  });

program.parseAsync().catch((error: unknown) => {
  const message = toErrorMessage(error);
  process.stderr.write(`docrawl: ${message}\n`);
  process.exitCode = 1;
});

function validateHttpUrl(input: string): void {
  const normalized = normalizeUrl(input);
  const protocol = new URL(normalized).protocol;

  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('URL must use http or https');
  }
}

function parseIntegerOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected integer, received: ${value}`);
  }

  return parsed;
}

function collectRepeatableOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function validatePositiveNumber(value: number, optionName: string): void {
  if (value <= 0) {
    throw new Error(`--${optionName} must be greater than 0`);
  }
}

function validateNonNegativeNumber(value: number, optionName: string): void {
  if (value < 0) {
    throw new Error(`--${optionName} must be 0 or greater`);
  }
}
