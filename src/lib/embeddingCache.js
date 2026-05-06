import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function normalizeQuery(query) {
  return String(query || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function cacheKey(query) {
  return crypto.createHash('sha256').update(normalizeQuery(query)).digest('hex');
}

function isValidEmbedding(value) {
  return Array.isArray(value) && value.length > 0 && value.every(n => Number.isFinite(n));
}

export class EmbeddingCache {
  constructor({ cachePath, maxEntries = 500 } = {}) {
    this.cachePath = cachePath;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.loaded = false;
  }

  async getOrCreate(query, producer) {
    this.#load();
    const normalized = normalizeQuery(query);
    const key = cacheKey(normalized);
    const cached = this.entries.get(key);
    if (cached && isValidEmbedding(cached.embedding)) {
      cached.lastUsedAt = Date.now();
      this.entries.set(key, cached);
      return { embedding: cached.embedding, cacheHit: true };
    }

    const embedding = await producer();
    if (!isValidEmbedding(embedding)) return { embedding, cacheHit: false };

    this.entries.set(key, {
      query: normalized,
      embedding,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });
    this.#trim();
    this.#save();
    return { embedding, cacheHit: false };
  }

  #load() {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.cachePath || !fs.existsSync(this.cachePath)) return;
    try {
      const rows = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
      if (!Array.isArray(rows)) return;
      for (const row of rows) {
        const key = row.key || cacheKey(row.query || '');
        if (key && isValidEmbedding(row.embedding)) this.entries.set(key, row);
      }
      this.#trim();
    } catch (error) {
      console.warn('[EmbeddingCache] Failed to load cache:', error.message);
      this.entries.clear();
    }
  }

  #save() {
    if (!this.cachePath) return;
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      const rows = Array.from(this.entries.entries()).map(([key, value]) => ({ key, ...value }));
      fs.writeFileSync(this.cachePath, JSON.stringify(rows));
    } catch (error) {
      console.warn('[EmbeddingCache] Failed to save cache:', error.message);
    }
  }

  #trim() {
    if (this.entries.size <= this.maxEntries) return;
    const sorted = Array.from(this.entries.entries())
      .sort((a, b) => (b[1].lastUsedAt || 0) - (a[1].lastUsedAt || 0))
      .slice(0, this.maxEntries);
    this.entries = new Map(sorted);
  }
}
