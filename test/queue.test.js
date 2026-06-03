import test from 'node:test';
import assert from 'node:assert/strict';

import { CrawlQueue } from '../dist/queue.js';

test('queue deduplicates normalized requested urls and preserves FIFO order', () => {
  const queue = new CrawlQueue();

  assert.equal(queue.enqueue('https://docs.example.com/guide/intro#top', 0), true);
  assert.equal(queue.enqueue('https://docs.example.com/guide/intro', 0), false);
  assert.equal(queue.enqueue('https://docs.example.com/guide/setup', 1), true);

  assert.deepEqual(queue.dequeue(), {
    url: 'https://docs.example.com/guide/intro',
    depth: 0,
  });

  assert.deepEqual(queue.dequeue(), {
    url: 'https://docs.example.com/guide/setup',
    depth: 1,
  });

  assert.equal(queue.isEmpty(), true);
});

test('queue tracks visited requested urls and visited final urls independently', () => {
  const queue = new CrawlQueue();

  queue.markVisited('https://docs.example.com/guide/intro');
  queue.markFinalVisited('https://docs.example.com/guide/final#section');

  assert.equal(queue.isVisited('https://docs.example.com/guide/intro/'), true);
  assert.equal(queue.hasVisitedFinalUrl('https://docs.example.com/guide/final'), true);
  assert.equal(queue.hasVisitedFinalUrl('https://docs.example.com/guide/other'), false);
});
