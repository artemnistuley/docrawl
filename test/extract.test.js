import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { sanitizeProtocolRelativeUrls } from '../dist/extract.js';

function makeDocument(head) {
  const { document } = parseHTML(`<html><head>${head}</head><body></body></html>`);
  return document;
}

const PAGE_URL = 'https://example.com/docs/page';

test('sanitizes protocol-relative og:url', () => {
  const doc = makeDocument('<meta property="og:url" content="//example.com/page">');
  sanitizeProtocolRelativeUrls(doc, PAGE_URL);
  assert.equal(
    doc.querySelector('meta[property="og:url"]').getAttribute('content'),
    'https://example.com/page',
  );
});

test('sanitizes protocol-relative twitter:url', () => {
  const doc = makeDocument('<meta property="twitter:url" content="//example.com/tw">');
  sanitizeProtocolRelativeUrls(doc, PAGE_URL);
  assert.equal(
    doc.querySelector('meta[property="twitter:url"]').getAttribute('content'),
    'https://example.com/tw',
  );
});

test('sanitizes protocol-relative link[rel=canonical]', () => {
  const doc = makeDocument('<link rel="canonical" href="//example.com/">');
  sanitizeProtocolRelativeUrls(doc, PAGE_URL);
  assert.equal(
    doc.querySelector('link[rel="canonical"]').getAttribute('href'),
    'https://example.com/',
  );
});

test('sanitizes protocol-relative link[rel=alternate]', () => {
  const doc = makeDocument(
    '<link rel="alternate" href="//example.com/en">' +
    '<link rel="alternate" href="//example.com/fr">',
  );
  sanitizeProtocolRelativeUrls(doc, PAGE_URL);
  const links = doc.querySelectorAll('link[rel="alternate"]');
  assert.equal(links[0].getAttribute('href'), 'https://example.com/en');
  assert.equal(links[1].getAttribute('href'), 'https://example.com/fr');
});

test('sanitizes protocol-relative url in JSON-LD', () => {
  const jsonLd = JSON.stringify({ '@type': 'WebPage', url: '//example.com/page' });
  const doc = makeDocument(`<script type="application/ld+json">${jsonLd}</script>`);
  sanitizeProtocolRelativeUrls(doc, PAGE_URL);
  const data = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
  assert.equal(data.url, 'https://example.com/page');
});

test('does not modify absolute URLs', () => {
  const doc = makeDocument('<meta property="og:url" content="https://example.com/abs">');
  sanitizeProtocolRelativeUrls(doc, PAGE_URL);
  assert.equal(
    doc.querySelector('meta[property="og:url"]').getAttribute('content'),
    'https://example.com/abs',
  );
});

test('does not modify relative URLs', () => {
  const doc = makeDocument('<link rel="canonical" href="/docs/page">');
  sanitizeProtocolRelativeUrls(doc, PAGE_URL);
  assert.equal(
    doc.querySelector('link[rel="canonical"]').getAttribute('href'),
    '/docs/page',
  );
});

test('handles empty or missing attributes', () => {
  const doc = makeDocument(
    '<meta property="og:url">' +
    '<link rel="canonical">',
  );
  sanitizeProtocolRelativeUrls(doc, PAGE_URL);
  assert.equal(doc.querySelector('meta[property="og:url"]').getAttribute('content'), null);
  assert.equal(doc.querySelector('link[rel="canonical"]').getAttribute('href'), null);
});

test('inherits protocol from page URL', () => {
  const doc = makeDocument('<meta property="og:url" content="//other.com/path">');
  sanitizeProtocolRelativeUrls(doc, 'http://example.com/page');
  assert.equal(
    doc.querySelector('meta[property="og:url"]').getAttribute('content'),
    'http://other.com/path',
  );
});

test('leaves JSON-LD with non-protocol-relative url unchanged', () => {
  const original = JSON.stringify({ '@type': 'WebPage', url: 'https://example.com/ok' });
  const doc = makeDocument(`<script type="application/ld+json">${original}</script>`);
  sanitizeProtocolRelativeUrls(doc, PAGE_URL);
  const data = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
  assert.equal(data.url, 'https://example.com/ok');
});
