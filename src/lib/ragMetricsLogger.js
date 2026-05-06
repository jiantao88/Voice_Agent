import fs from 'node:fs';
import path from 'node:path';

function dateKey(ts = Date.now()) {
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function ratio(count, total) {
  return total > 0 ? count / total : 0;
}

function percentile(values, pct) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * pct) - 1);
  return sorted[index];
}

export class RagMetricsLogger {
  constructor({ metricsDir } = {}) {
    this.metricsDir = metricsDir || path.join(process.cwd(), '.rag-metrics');
  }

  recordSearch(event) {
    fs.mkdirSync(this.metricsDir, { recursive: true });
    const normalized = {
      eventName: 'rag_search_complete',
      eventTime: new Date().toISOString(),
      queryId: event.queryId,
      position: event.position || '',
      searchStrategy: event.searchStrategy || 'hybrid',
      resultCount: event.resultCount || 0,
      isHit: Boolean(event.isHit),
      isStrongHit: Boolean(event.isStrongHit),
      topScore: event.topScore || 0,
      topMatchSources: event.topMatchSources || [],
      topFilename: event.topFilename || '',
      topDomain: event.topDomain || '',
      embeddingCacheHit: Boolean(event.embeddingCacheHit),
      timings: event.timings || {},
    };
    fs.appendFileSync(this.#eventsPath(), `${JSON.stringify(normalized)}\n`);
    return normalized;
  }

  getTodaySummary(now = Date.now()) {
    const today = dateKey(now);
    const events = this.#readEvents().filter(event => dateKey(Date.parse(event.eventTime)) === today);
    const searchCount = events.length;
    const hitCount = events.filter(event => event.isHit).length;
    const strongHitCount = events.filter(event => event.isStrongHit).length;
    const ftsHitCount = events.filter(event => event.topMatchSources?.includes('fts')).length;
    const vectorHitCount = events.filter(event => event.topMatchSources?.includes('vec')).length;
    const hybridHitCount = events.filter(event =>
      event.topMatchSources?.includes('fts') && event.topMatchSources?.includes('vec')
    ).length;
    const embeddingCacheHitCount = events.filter(event => event.embeddingCacheHit).length;
    const latencies = events.map(event => Number(event.timings?.total || 0)).filter(Number.isFinite);
    const latencySum = latencies.reduce((sum, value) => sum + value, 0);

    return {
      searchCount,
      hitCount,
      strongHitCount,
      hitRate: ratio(hitCount, searchCount),
      strongHitRate: ratio(strongHitCount, searchCount),
      ftsHitRate: ratio(ftsHitCount, searchCount),
      vectorHitRate: ratio(vectorHitCount, searchCount),
      hybridHitRate: ratio(hybridHitCount, searchCount),
      embeddingCacheHitRate: ratio(embeddingCacheHitCount, searchCount),
      avgLatencyMs: searchCount > 0 ? Math.round(latencySum / searchCount) : 0,
      p95LatencyMs: percentile(latencies, 0.95),
    };
  }

  #eventsPath() {
    return path.join(this.metricsDir, 'rag-events.jsonl');
  }

  #readEvents() {
    const p = this.#eventsPath();
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
}
