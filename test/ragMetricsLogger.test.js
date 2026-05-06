import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { RagMetricsLogger } from '../src/lib/ragMetricsLogger.js';

describe('RagMetricsLogger', () => {
  const cleanup = [];

  afterEach(() => {
    while (cleanup.length) {
      rmSync(cleanup.pop(), { recursive: true, force: true });
    }
  });

  it('records search events and summarizes today hit rates', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'vtt-rag-metrics-'));
    cleanup.push(dir);
    const logger = new RagMetricsLogger({ metricsDir: dir });

    logger.recordSearch({
      queryId: 'q1',
      position: 'frontend',
      resultCount: 2,
      isHit: true,
      isStrongHit: true,
      topScore: 0.82,
      topMatchSources: ['fts', 'vec'],
      timings: { total: 100 },
    });
    logger.recordSearch({
      queryId: 'q2',
      position: 'backend',
      resultCount: 1,
      isHit: true,
      isStrongHit: false,
      topScore: 0.42,
      topMatchSources: ['fts'],
      timings: { total: 200 },
    });
    logger.recordSearch({
      queryId: 'q3',
      position: '',
      resultCount: 0,
      isHit: false,
      isStrongHit: false,
      topScore: 0,
      topMatchSources: [],
      timings: { total: 300 },
    });

    const summary = logger.getTodaySummary();

    expect(summary.searchCount).toBe(3);
    expect(summary.hitRate).toBeCloseTo(2 / 3);
    expect(summary.strongHitRate).toBeCloseTo(1 / 3);
    expect(summary.avgLatencyMs).toBe(200);
    expect(summary.p95LatencyMs).toBe(300);
    expect(summary.ftsHitRate).toBeCloseTo(2 / 3);
    expect(summary.vectorHitRate).toBeCloseTo(1 / 3);
    expect(summary.hybridHitRate).toBeCloseTo(1 / 3);
  });
});
