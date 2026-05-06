import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { HybridKnowledgeStore } from '../src/lib/hybridKnowledgeStore.js';

function tmpDbPath() {
  return path.join(mkdtempSync(path.join(os.tmpdir(), 'vtt-knowledge-')), 'knowledge.sqlite');
}

describe('HybridKnowledgeStore', () => {
  const cleanup = [];

  afterEach(() => {
    while (cleanup.length) {
      rmSync(cleanup.pop(), { recursive: true, force: true });
    }
  });

  it('finds Chinese technical content through FTS5 keyword search', () => {
    const dbPath = tmpDbPath();
    cleanup.push(path.dirname(dbPath));
    const store = new HybridKnowledgeStore({ dbPath, dimension: 3 });
    store.load();

    store.upsertChunk({
      id: 'react-diff',
      filename: 'frontend.md',
      content: 'React 虚拟 DOM 和 Diff 算法用于减少真实 DOM 更新。',
      position: 'frontend',
      domain: 'react',
      embedding: [1, 0, 0],
    });
    store.upsertChunk({
      id: 'redis-cache',
      filename: 'backend.md',
      content: 'Redis 缓存穿透通常用布隆过滤器和空值缓存处理。',
      position: 'backend',
      domain: 'redis',
      embedding: [0, 1, 0],
    });

    const results = store.search({ query: '虚拟 DOM Diff', queryEmbedding: [0, 0, 1], topK: 2 });

    expect(results[0].id).toBe('react-diff');
    expect(results[0].matchSources).toContain('fts');
  });

  it('combines vector similarity with active-position weighting', () => {
    const dbPath = tmpDbPath();
    cleanup.push(path.dirname(dbPath));
    const store = new HybridKnowledgeStore({ dbPath, dimension: 3 });
    store.load();

    store.upsertChunk({
      id: 'frontend-render',
      filename: 'frontend.md',
      content: '前端渲染性能优化包括减少重排重绘和控制长任务。',
      position: 'frontend',
      domain: 'performance',
      embedding: [0.9, 0.1, 0],
    });
    store.upsertChunk({
      id: 'backend-render',
      filename: 'backend.md',
      content: '服务端模板渲染会关注缓存、吞吐量和接口耗时。',
      position: 'backend',
      domain: 'performance',
      embedding: [0.92, 0.08, 0],
    });

    const results = store.search({
      query: '页面卡顿怎么优化',
      queryEmbedding: [0.9, 0.1, 0],
      topK: 2,
      position: 'frontend',
    });

    expect(results[0].id).toBe('frontend-render');
    expect(results[0].matchSources).toContain('vec');
  });

  it('returns search metrics when requested', () => {
    const dbPath = tmpDbPath();
    cleanup.push(path.dirname(dbPath));
    const store = new HybridKnowledgeStore({ dbPath, dimension: 3 });
    store.load();

    store.upsertChunk({
      id: 'react-rag',
      filename: 'frontend.md',
      content: 'React 面试中常问虚拟 DOM、Diff 和性能优化。',
      position: 'frontend',
      domain: 'react',
      embedding: [1, 0, 0],
    });

    const { results, metrics } = store.search({
      query: 'React Diff',
      queryEmbedding: [1, 0, 0],
      topK: 3,
      position: 'frontend',
      includeMetrics: true,
    });

    expect(results).toHaveLength(1);
    expect(metrics.isHit).toBe(true);
    expect(metrics.isStrongHit).toBe(true);
    expect(metrics.resultCount).toBe(1);
    expect(metrics.topScore).toBeGreaterThan(0);
    expect(metrics.topMatchSources).toContain('fts');
    expect(metrics.topMatchSources).toContain('vec');
    expect(metrics.timings.total).toBeGreaterThanOrEqual(0);
  });

  it('falls back to FTS5 when query embedding is unavailable', () => {
    const dbPath = tmpDbPath();
    cleanup.push(path.dirname(dbPath));
    const store = new HybridKnowledgeStore({ dbPath, dimension: 3 });
    store.load();

    store.upsertChunk({
      id: 'browser-cache',
      filename: 'frontend.md',
      content: '浏览器强缓存和协商缓存是前端面试中的常见问题。',
      position: 'frontend',
      domain: 'browser',
      embedding: [1, 0, 0],
    });

    const { results, metrics } = store.search({
      query: '浏览器 协商缓存',
      queryEmbedding: null,
      topK: 3,
      includeMetrics: true,
    });

    expect(results[0].id).toBe('browser-cache');
    expect(results[0].matchSources).toEqual(['fts']);
    expect(metrics.isHit).toBe(true);
    expect(metrics.vectorResultCount).toBe(0);
    expect(metrics.ftsResultCount).toBe(1);
  });
});
