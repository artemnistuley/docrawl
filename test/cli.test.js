import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const cliPath = path.join(process.cwd(), 'dist', 'cli.js');

test('cli shows top-level help with commands', () => {
  const result = spawnSync('node', [cliPath, '--help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /crawl \[options\] <url>/);
  assert.match(result.stdout, /parse \[options\] <url>/);
});

test('cli rejects invalid crawl url', () => {
  const result = spawnSync('node', [cliPath, 'crawl', 'mailto:test@example.com'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /URL must use http or https/);
});
