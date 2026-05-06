import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { EmbeddingCache } from '../src/lib/embeddingCache.js';

describe('EmbeddingCache', () => {
  const cleanup = [];

  afterEach(() => {
    while (cleanup.length) {
      rmSync(cleanup.pop(), { recursive: true, force: true });
    }
  });

  it('reuses normalized query embeddings from disk cache', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'vtt-embedding-cache-'));
    cleanup.push(dir);
    const cachePath = path.join(dir, 'query-embeddings.json');
    const cache = new EmbeddingCache({ cachePath, maxEntries: 10 });
    let calls = 0;

    const first = await cache.getOrCreate('  React  Hooks 怎么优化? ', async () => {
      calls += 1;
      return [0.1, 0.2, 0.3];
    });
    const second = await cache.getOrCreate('react hooks 怎么优化?', async () => {
      calls += 1;
      return [9, 9, 9];
    });
    const reloaded = new EmbeddingCache({ cachePath, maxEntries: 10 });
    const third = await reloaded.getOrCreate('REACT HOOKS 怎么优化?', async () => {
      calls += 1;
      return [8, 8, 8];
    });

    expect(first).toEqual({ embedding: [0.1, 0.2, 0.3], cacheHit: false });
    expect(second).toEqual({ embedding: [0.1, 0.2, 0.3], cacheHit: true });
    expect(third).toEqual({ embedding: [0.1, 0.2, 0.3], cacheHit: true });
    expect(calls).toBe(1);
  });
});
