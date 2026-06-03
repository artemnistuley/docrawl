import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFilters, isBinaryExtension, isInScope, isNonHttpScheme, matchesBuiltinSkipPatterns } from '../dist/filters.js';

const pathScope = {
  baseUrl: 'https://docs.example.com/guide/',
  mode: 'path',
};

const domainScope = {
  baseUrl: 'https://docs.example.com/',
  mode: 'domain',
};

test('isNonHttpScheme rejects non-http schemes', () => {
  assert.equal(isNonHttpScheme('mailto:test@example.com'), true);
  assert.equal(isNonHttpScheme(' javascript:void(0) '), true);
  assert.equal(isNonHttpScheme('https://docs.example.com/guide'), false);
});

test('isBinaryExtension detects binary and non-html assets', () => {
  assert.equal(isBinaryExtension('https://docs.example.com/file.pdf'), true);
  assert.equal(isBinaryExtension('https://docs.example.com/image.PNG'), true);
  assert.equal(isBinaryExtension('https://docs.example.com/guide/intro'), false);
});

test('isInScope respects path and domain scope', () => {
  assert.equal(isInScope('https://docs.example.com/guide/intro', pathScope), true);
  assert.equal(isInScope('https://docs.example.com/blog/post', pathScope), false);
  assert.equal(isInScope('https://docs.example.com/blog/post', domainScope), true);
  assert.equal(isInScope('https://other.example.com/guide/intro', domainScope), false);
});

test('matchesBuiltinSkipPatterns catches nested utility routes', () => {
  assert.equal(matchesBuiltinSkipPatterns('https://docs.example.com/guide/search'), true);
  assert.equal(matchesBuiltinSkipPatterns('https://docs.example.com/guide/changelog/'), true);
  assert.equal(matchesBuiltinSkipPatterns('https://docs.example.com/guide/intro'), false);
});

test('applyFilters follows precedence rules', () => {
  assert.deepEqual(
    applyFilters('#section', pathScope, { include: [], exclude: [] }),
    { allowed: false, reason: 'fragment_only' },
  );

  assert.deepEqual(
    applyFilters('mailto:test@example.com', pathScope, { include: [], exclude: [] }),
    { allowed: false, reason: 'non_http_scheme' },
  );

  assert.deepEqual(
    applyFilters('https://docs.example.com/blog/post', pathScope, { include: ['/blog/**'], exclude: [] }),
    { allowed: false, reason: 'out_of_scope' },
  );

  assert.deepEqual(
    applyFilters('https://docs.example.com/guide/changelog/', pathScope, { include: [], exclude: [] }),
    { allowed: false, reason: 'builtin_skip' },
  );

  assert.deepEqual(
    applyFilters('https://docs.example.com/guide/changelog/', pathScope, {
      include: ['/guide/changelog/**'],
      exclude: [],
    }),
    { allowed: true, normalizedUrl: 'https://docs.example.com/guide/changelog' },
  );

  assert.deepEqual(
    applyFilters('https://docs.example.com/guide/file.pdf', pathScope, {
      include: ['**/*.pdf'],
      exclude: [],
    }),
    { allowed: false, reason: 'binary_extension' },
  );

  assert.deepEqual(
    applyFilters('https://docs.example.com/guide/changelog/', pathScope, {
      include: ['/guide/changelog/**'],
      exclude: ['/guide/changelog/**'],
    }),
    { allowed: false, reason: 'excluded' },
  );

  assert.deepEqual(
    applyFilters('https://docs.example.com/guide/file.pdf', pathScope, { include: [], exclude: [] }),
    { allowed: false, reason: 'binary_extension' },
  );
});
