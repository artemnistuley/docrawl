import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { crawl } from '../dist/crawl.js';
import { fetchPage } from '../dist/fetch.js';

test('crawl deduplicates pages by normalized finalUrl after fetch', async () => {
  const originalFetch = global.fetch;
  const outputDir = path.join(process.cwd(), 'tmp-output', 'crawl-finalurl-dedup');

  const htmlByRequestedUrl = new Map([
    [
      'https://docs.example.com/guide/one',
      '<html><body><main><h1>One</h1><p>This page has enough words to be extracted successfully by the crawler.</p><a href="/guide/two">Two</a></main></body></html>',
    ],
    [
      'https://docs.example.com/guide/two',
      '<html><body><main><h1>Two</h1><p>This second page resolves to the same final destination after redirects happen.</p></main></body></html>',
    ],
  ]);

  global.fetch = async (input) => {
    const requestedUrl = typeof input === 'string' ? input : input.url;
    const html = htmlByRequestedUrl.get(requestedUrl);

    if (html === undefined) {
      throw new Error(`Unexpected fetch for ${requestedUrl}`);
    }

    return {
      url: 'https://docs.example.com/guide/final',
      status: 200,
      headers: new Headers({
        'content-type': 'text/html; charset=utf-8',
      }),
      text: async () => html,
    };
  };

  try {
    await fs.rm(outputDir, { recursive: true, force: true });

    const manifest = await crawl('https://docs.example.com/guide/one', {
      output: outputDir,
      singleFile: false,
      domain: false,
      maxPages: 10,
      concurrency: 1,
      delay: 0,
      sitemap: false,
      include: [],
      exclude: [],
      verbose: false,
    });

    assert.equal(manifest.summary.total, 2);
    assert.equal(manifest.summary.succeeded, 1);
    assert.equal(manifest.summary.skipped, 1);

    assert.equal(manifest.results[0]?.status, 'success');
    assert.equal(manifest.results[0]?.finalUrl, 'https://docs.example.com/guide/final');
    assert.equal(manifest.results[1]?.status, 'skipped_filtered');
    assert.equal(manifest.results[1]?.error, 'duplicate_final_url');
  } finally {
    global.fetch = originalFetch;
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test('crawl continues processing links discovered after other workers initially see an empty queue', async () => {
  const originalFetch = global.fetch;
  const outputDir = path.join(process.cwd(), 'tmp-output', 'crawl-concurrency');

  global.fetch = async (input) => {
    const requestedUrl = typeof input === 'string' ? input : input.url;

    if (requestedUrl === 'https://docs.example.com/guide/start') {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        url: requestedUrl,
        status: 200,
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
        }),
        text: async () => '<html><body><main><h1>Start</h1><p>Seed page with enough words for a successful extraction result.</p><a href="/guide/a">A</a><a href="/guide/b">B</a></main></body></html>',
      };
    }

    if (requestedUrl === 'https://docs.example.com/guide/a') {
      return {
        url: requestedUrl,
        status: 200,
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
        }),
        text: async () => '<html><body><main><h1>A</h1><p>This page has enough words to be processed successfully after the queue becomes non-empty again.</p></main></body></html>',
      };
    }

    if (requestedUrl === 'https://docs.example.com/guide/b') {
      return {
        url: requestedUrl,
        status: 200,
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
        }),
        text: async () => '<html><body><main><h1>B</h1><p>This page also has enough words to be processed successfully after discovery.</p></main></body></html>',
      };
    }

    throw new Error(`Unexpected fetch for ${requestedUrl}`);
  };

  try {
    await fs.rm(outputDir, { recursive: true, force: true });

    const manifest = await crawl('https://docs.example.com/guide/start', {
      output: outputDir,
      singleFile: false,
      domain: false,
      maxPages: 10,
      concurrency: 3,
      delay: 0,
      sitemap: false,
      include: [],
      exclude: [],
      verbose: false,
    });

    assert.equal(manifest.summary.succeeded, 3);
    assert.equal(manifest.results.some((result) => result.url === 'https://docs.example.com/guide/a'), true);
    assert.equal(manifest.results.some((result) => result.url === 'https://docs.example.com/guide/b'), true);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test('fetchPage cancels 429 response bodies before retrying', async () => {
  const originalFetch = global.fetch;
  let requestCount = 0;
  let cancelCount = 0;

  global.fetch = async () => {
    requestCount += 1;

    if (requestCount === 1) {
      return {
        url: 'https://docs.example.com/guide/intro',
        status: 429,
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
        }),
        body: {
          cancel: async () => {
            cancelCount += 1;
          },
        },
        text: async () => '',
      };
    }

    return {
      url: 'https://docs.example.com/guide/intro',
      status: 200,
      headers: new Headers({
        'content-type': 'text/html; charset=utf-8',
      }),
      text: async () => '<html><body>ok</body></html>',
    };
  };

  try {
    const result = await fetchPage('https://docs.example.com/guide/intro', {
      delayMs: 0,
      retryBackoffMs: 0,
    });

    assert.equal(cancelCount, 1);
    assert.equal(result.status, 200);
    assert.match(result.html ?? '', /ok/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchPage returns body instead of html for repeated 429 html responses', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    url: 'https://docs.example.com/guide/intro',
    status: 429,
    headers: new Headers({
      'content-type': 'text/html; charset=utf-8',
    }),
    body: {
      cancel: async () => {},
    },
    text: async () => '<html><body>rate limited</body></html>',
  });

  try {
    const result = await fetchPage('https://docs.example.com/guide/intro', {
      delayMs: 0,
      retryBackoffMs: 0,
    });

    assert.equal(result.status, 429);
    assert.equal(result.html, undefined);
    assert.match(result.body ?? '', /rate limited/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('crawl records network failures as error_network', async () => {
  const originalFetch = global.fetch;
  const outputDir = path.join(process.cwd(), 'tmp-output', 'crawl-network-error');

  global.fetch = async () => {
    throw new Error('getaddrinfo ENOTFOUND docs.example.com');
  };

  try {
    await fs.rm(outputDir, { recursive: true, force: true });

    const manifest = await crawl('https://docs.example.com/guide/start', {
      output: outputDir,
      singleFile: false,
      domain: false,
      maxPages: 10,
      concurrency: 1,
      delay: 0,
      sitemap: false,
      include: [],
      exclude: [],
      verbose: false,
    });

    assert.equal(manifest.summary.failed, 1);
    assert.equal(manifest.results[0]?.status, 'error_network');
    assert.match(manifest.results[0]?.error ?? '', /ENOTFOUND/);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test('crawl discovers sitemap urls from host root and follows nested sitemap indexes', async () => {
  const originalFetch = global.fetch;
  const outputDir = path.join(process.cwd(), 'tmp-output', 'crawl-sitemap');

  const responses = new Map([
    [
      'https://docs.example.com/sitemap.xml',
      {
        url: 'https://docs.example.com/sitemap.xml',
        status: 200,
        contentType: 'application/xml; charset=utf-8',
        body: '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://docs.example.com/nested-sitemap.xml</loc></sitemap></sitemapindex>',
      },
    ],
    [
      'https://docs.example.com/nested-sitemap.xml',
      {
        url: 'https://docs.example.com/nested-sitemap.xml',
        status: 200,
        contentType: 'application/xml; charset=utf-8',
        body: '<?xml version="1.0"?><urlset><url><loc>https://docs.example.com/guide/intro</loc></url><url><loc>https://docs.example.com/blog/post</loc></url></urlset>',
      },
    ],
    [
      'https://docs.example.com/guide/intro',
      {
        url: 'https://docs.example.com/guide/intro',
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<html><body><main><h1>Intro</h1><p>This sitemap-seeded page has enough words to be treated as a success result.</p></main></body></html>',
      },
    ],
  ]);

  global.fetch = async (input) => {
    const requestedUrl = typeof input === 'string' ? input : input.url;
    const response = responses.get(requestedUrl);

    if (response === undefined) {
      throw new Error(`Unexpected fetch for ${requestedUrl}`);
    }

    return {
      url: response.url,
      status: response.status,
      headers: new Headers({
        'content-type': response.contentType,
      }),
      text: async () => response.body,
    };
  };

  try {
    await fs.rm(outputDir, { recursive: true, force: true });

    const manifest = await crawl('https://docs.example.com/guide/start', {
      output: outputDir,
      singleFile: false,
      domain: false,
      maxPages: 10,
      concurrency: 1,
      delay: 0,
      sitemap: true,
      include: [],
      exclude: [],
      verbose: false,
    });

    assert.equal(manifest.summary.succeeded, 1);
    assert.equal(manifest.summary.failed, 1);

    const introResult = manifest.results.find((result) => result.url === 'https://docs.example.com/guide/intro');
    assert.ok(introResult);
    assert.equal(introResult.status, 'success');

    const blogResult = manifest.results.find((result) => result.url === 'https://docs.example.com/blog/post');
    assert.equal(blogResult, undefined);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test('crawl falls back to /sitemap_index.xml when /sitemap.xml is valid but empty', async () => {
  const originalFetch = global.fetch;
  const outputDir = path.join(process.cwd(), 'tmp-output', 'crawl-sitemap-fallback');

  const responses = new Map([
    [
      'https://docs.example.com/sitemap.xml',
      {
        url: 'https://docs.example.com/sitemap.xml',
        status: 200,
        contentType: 'application/xml; charset=utf-8',
        body: '<?xml version="1.0"?><urlset></urlset>',
      },
    ],
    [
      'https://docs.example.com/sitemap_index.xml',
      {
        url: 'https://docs.example.com/sitemap_index.xml',
        status: 200,
        contentType: 'application/xml; charset=utf-8',
        body: '<?xml version="1.0"?><urlset><url><loc>https://docs.example.com/guide/from-index</loc></url></urlset>',
      },
    ],
    [
      'https://docs.example.com/guide/from-index',
      {
        url: 'https://docs.example.com/guide/from-index',
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<html><body><main><h1>From index</h1><p>This sitemap-index page has enough words to be processed successfully.</p></main></body></html>',
      },
    ],
  ]);

  global.fetch = async (input) => {
    const requestedUrl = typeof input === 'string' ? input : input.url;
    const response = responses.get(requestedUrl);

    if (response === undefined) {
      throw new Error(`Unexpected fetch for ${requestedUrl}`);
    }

    return {
      url: response.url,
      status: response.status,
      headers: new Headers({
        'content-type': response.contentType,
      }),
      text: async () => response.body,
    };
  };

  try {
    await fs.rm(outputDir, { recursive: true, force: true });

    const manifest = await crawl('https://docs.example.com/guide/start', {
      output: outputDir,
      singleFile: false,
      domain: false,
      maxPages: 10,
      concurrency: 1,
      delay: 0,
      sitemap: true,
      include: [],
      exclude: [],
      verbose: false,
    });

    const indexedResult = manifest.results.find((result) => result.url === 'https://docs.example.com/guide/from-index');
    assert.ok(indexedResult);
    assert.equal(indexedResult.status, 'success');
  } finally {
    global.fetch = originalFetch;
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test('crawl writes single-file output and adjacent manifest in --single-file mode', async () => {
  const originalFetch = global.fetch;
  const outputPath = path.join(process.cwd(), 'tmp-output', 'single-file', 'context.md');

  global.fetch = async (input) => {
    const requestedUrl = typeof input === 'string' ? input : input.url;

    if (requestedUrl === 'https://docs.example.com/guide/intro') {
      return {
        url: requestedUrl,
        status: 200,
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
        }),
        text: async () => '<html><body><main><h1>Intro</h1><p>This page has enough words to appear in single file output successfully.</p><a href="/guide/intro-2">Second</a></main></body></html>',
      };
    }

    return {
      url: requestedUrl,
      status: 200,
      headers: new Headers({
        'content-type': 'text/html; charset=utf-8',
      }),
      text: async () => '<html><body><main><h1>Intro</h1><p>This second page intentionally uses the same heading so anchors need deduplication.</p></main></body></html>',
    };
  };

  try {
    await fs.rm(path.dirname(outputPath), { recursive: true, force: true });

    const manifest = await crawl('https://docs.example.com/guide/intro', {
      output: outputPath,
      singleFile: true,
      domain: false,
      maxPages: 2,
      concurrency: 1,
      delay: 0,
      sitemap: false,
      include: [],
      exclude: [],
      verbose: false,
    });

    assert.equal(manifest.summary.succeeded, 2);

    const singleFileContent = await fs.readFile(outputPath, 'utf8');
    const manifestPath = path.join(path.dirname(outputPath), 'context.manifest.json');
    const adjacentManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

    assert.match(singleFileContent, /^# docs\.example\.com/m);
    assert.match(singleFileContent, /## Table of contents/);
    assert.match(singleFileContent, /## Intro/);
    assert.match(singleFileContent, /\[Intro\]\(#intro\)/);
    assert.match(singleFileContent, /\[Intro\]\(#intro-2\)/);
    assert.match(singleFileContent, /<a id="intro"><\/a>/);
    assert.match(singleFileContent, /<a id="intro-2"><\/a>/);
    assert.equal(adjacentManifest.summary.succeeded, 2);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(path.dirname(outputPath), { recursive: true, force: true });
  }
});

test('crawl produces stable output paths across reruns even if discovery order changes', async () => {
  const originalFetch = global.fetch;
  const outputDirA = path.join(process.cwd(), 'tmp-output', 'deterministic-a');
  const outputDirB = path.join(process.cwd(), 'tmp-output', 'deterministic-b');
  let runNumber = 0;

  global.fetch = async (input) => {
    const requestedUrl = typeof input === 'string' ? input : input.url;

    if (requestedUrl === 'https://docs.example.com/guide/start') {
      runNumber += 1;
      const links = runNumber === 1
        ? '<a href="/guide/install">Install</a><a href="/guide/install?lang=en">Install EN</a>'
        : '<a href="/guide/install?lang=en">Install EN</a><a href="/guide/install">Install</a>';

      return {
        url: requestedUrl,
        status: 200,
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
        }),
        text: async () => `<html><body><main><h1>Start</h1><p>Seed page with enough words for a successful extraction result.</p>${links}</main></body></html>`,
      };
    }

    if (requestedUrl === 'https://docs.example.com/guide/install') {
      return {
        url: requestedUrl,
        status: 200,
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
        }),
        text: async () => '<html><body><main><h1>Install</h1><p>This installation page has enough content to be emitted successfully.</p></main></body></html>',
      };
    }

    if (requestedUrl === 'https://docs.example.com/guide/install?lang=en') {
      return {
        url: requestedUrl,
        status: 200,
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
        }),
        text: async () => '<html><body><main><h1>Install EN</h1><p>This localized installation page also has enough content to be emitted successfully.</p></main></body></html>',
      };
    }

    throw new Error(`Unexpected fetch for ${requestedUrl}`);
  };

  try {
    await fs.rm(outputDirA, { recursive: true, force: true });
    await fs.rm(outputDirB, { recursive: true, force: true });

    const manifestA = await crawl('https://docs.example.com/guide/start', {
      output: outputDirA,
      singleFile: false,
      domain: false,
      maxPages: 10,
      concurrency: 1,
      delay: 0,
      sitemap: false,
      include: [],
      exclude: [],
      verbose: false,
    });

    const manifestB = await crawl('https://docs.example.com/guide/start', {
      output: outputDirB,
      singleFile: false,
      domain: false,
      maxPages: 10,
      concurrency: 1,
      delay: 0,
      sitemap: false,
      include: [],
      exclude: [],
      verbose: false,
    });

    const successfulA = manifestA.results
      .filter((result) => result.status === 'success')
      .slice()
      .sort((left, right) => left.url.localeCompare(right.url))
      .map((result) => [result.url, result.outputPath]);
    const successfulB = manifestB.results
      .filter((result) => result.status === 'success')
      .slice()
      .sort((left, right) => left.url.localeCompare(right.url))
      .map((result) => [result.url, result.outputPath]);

    assert.deepEqual(successfulA, successfulB);
    assert.deepEqual(successfulA, [
      ['https://docs.example.com/guide/install', 'guide/install.md'],
      ['https://docs.example.com/guide/install?lang=en', 'guide/install--03d468.md'],
      ['https://docs.example.com/guide/start', 'guide/start.md'],
    ]);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(outputDirA, { recursive: true, force: true });
    await fs.rm(outputDirB, { recursive: true, force: true });
  }
});
