import { describe, expect, it } from 'vitest';
import { buildRAGMetricsSummaryHTML } from '../src/renderer/aiChat.js';

describe('buildRAGMetricsSummaryHTML', () => {
  it('renders current search metrics and today summary', () => {
    const html = buildRAGMetricsSummaryHTML({
      knowledgeMetrics: {
        isHit: true,
        isStrongHit: true,
        resultCount: 5,
        topScore: 0.82,
        topMatchSources: ['fts', 'vec'],
        timings: { total: 136 },
      },
      knowledgeMetricsSummary: {
        searchCount: 42,
        hitRate: 0.78,
        strongHitRate: 0.45,
        avgLatencyMs: 128,
        p95LatencyMs: 310,
      },
    });

    expect(html).toContain('知识库命中概览');
    expect(html).toContain('强命中');
    expect(html).toContain('82%');
    expect(html).toContain('FTS + 向量');
    expect(html).toContain('命中率 78%');
    expect(html).toContain('P95 310ms');
  });

  it('renders latency waterfall with cache and skipped web search signals', () => {
    const html = buildRAGMetricsSummaryHTML({
      timings: {
        questionExtraction: 4,
        pdfSearch: 118,
        webSearch: 0,
        total: 122,
      },
      webSearchSkipped: true,
      webSearchSkipReason: 'strong_kb_hit',
      knowledgeMetrics: {
        isHit: true,
        isStrongHit: true,
        resultCount: 4,
        topScore: 0.86,
        topMatchSources: ['fts', 'vec'],
        embeddingCacheHit: true,
        timings: { embedding: 1, fts: 22, vector: 74, merge: 12, total: 109 },
      },
      llmMetrics: {
        firstToken: 620,
        total: 1840,
      },
    });

    expect(html).toContain('耗时瀑布');
    expect(html).toContain('问题提取');
    expect(html).toContain('Embedding');
    expect(html).toContain('缓存命中');
    expect(html).toContain('Web 搜索');
    expect(html).toContain('已跳过');
    expect(html).toContain('LLM 首 token');
    expect(html).toContain('620ms');
    expect(html).toContain('LLM 总耗时');
  });
});
