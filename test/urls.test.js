import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveScope,
  normalizeTrailingSlash,
  normalizeUrl,
  resolveCollision,
  urlToOutputPath,
} from '../dist/urls.js';

test('normalizeUrl removes fragments, strips utm params, and normalizes default ports', () => {
  assert.equal(
    normalizeUrl('HTTPS://Docs.Example.com:443/guide/intro/?utm_source=x&utm_medium=y&a=1#top'),
    'https://docs.example.com/guide/intro?a=1',
  );
});

test('normalizeTrailingSlash behaves deterministically', () => {
  assert.equal(
    normalizeTrailingSlash('https://docs.example.com/guide/intro/'),
    'https://docs.example.com/guide/intro',
  );
  assert.equal(
    normalizeTrailingSlash('https://docs.example.com/'),
    'https://docs.example.com/',
  );
});

test('deriveScope returns path scope by default and domain scope with --domain', () => {
  assert.deepEqual(deriveScope('https://docs.example.com/guide/intro', false), {
    baseUrl: 'https://docs.example.com/guide/',
    mode: 'path',
  });

  assert.deepEqual(deriveScope('https://docs.example.com/guide/intro', true), {
    baseUrl: 'https://docs.example.com/',
    mode: 'domain',
  });
});

test('urlToOutputPath maps urls deterministically', () => {
  const baseUrl = 'https://docs.example.com/guide/';

  assert.equal(
    urlToOutputPath('https://docs.example.com/guide/', baseUrl),
    'guide/index.md',
  );

  assert.equal(
    urlToOutputPath('https://docs.example.com/guide/intro', baseUrl),
    'guide/intro.md',
  );

  assert.equal(
    urlToOutputPath('https://docs.example.com/guide/advanced/topic', baseUrl),
    'guide/advanced/topic.md',
  );
});

test('resolveCollision adds a stable suffix independent of processing order', () => {
  const outputPath = 'guide/install.md';
  const firstUrl = 'https://docs.example.com/guide/install';
  const secondUrl = 'https://docs.example.com/guide/install?lang=en';
  const existingPaths = new Map([[outputPath, firstUrl]]);

  const resolvedA = resolveCollision(outputPath, secondUrl, existingPaths);
  const resolvedB = resolveCollision(outputPath, secondUrl, existingPaths);

  assert.equal(resolvedA, resolvedB);
  assert.match(resolvedA, /^guide\/install--[0-9a-f]{6}\.md$/);
});
