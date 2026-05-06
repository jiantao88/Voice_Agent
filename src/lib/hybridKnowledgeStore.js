import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

function normalizeEmbedding(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) return null;
  if (!embedding.every(n => Number.isFinite(n))) return null;
  return embedding;
}

function toVecParam(embedding) {
  return new Float32Array(embedding);
}

function normalizeFtsQuery(query) {
  return String(query || '')
    .replace(/["'`]/g, ' ')
    .replace(/[^\p{L}\p{N}_\s.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scorePosition(doc, activePosition) {
  if (!activePosition) return 1;
  if (doc.position === activePosition) return 1.3;
  if (doc.position === 'common') return 1.15;
  return 1;
}

function elapsedSince(start) {
  return Math.max(0, Date.now() - start);
}

export class HybridKnowledgeStore {
  constructor({ dbPath, dimension } = {}) {
    this.dbPath = dbPath || ':memory:';
    this.dimension = dimension || null;
    this.db = null;
  }

  load() {
    if (this.db) return;
    this.db = new Database(this.dbPath);
    sqliteVec.load(this.db);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.#createBaseSchema();

    const savedDimension = this.#getMeta('vector_dimension');
    if (savedDimension) this.dimension = Number(savedDimension);
    if (this.dimension) this.#ensureVectorTable(this.dimension);
  }

  close() {
    this.db?.close();
    this.db = null;
  }

  getAllChunks() {
    this.#assertLoaded();
    return this.db.prepare(`
      SELECT id, filename, content, position, domain, sourceType, createdAt, updatedAt,
             page, startPage, endPage, heading, type, techPoint, category, priority
      FROM chunks
      ORDER BY createdAt ASC, rowid ASC
    `).all();
  }

  getChunks({ filename, position, domain, searchText } = {}) {
    this.#assertLoaded();
    let sql = `
      SELECT id, filename, content, position, domain, sourceType, createdAt, updatedAt,
             page, startPage, endPage, heading, type, techPoint, category, priority
      FROM chunks
      WHERE 1 = 1
    `;
    const params = {};
    if (filename) { sql += ' AND filename = @filename'; params.filename = filename; }
    if (position) { sql += ' AND position = @position'; params.position = position; }
    if (domain) { sql += ' AND domain = @domain'; params.domain = domain; }
    if (searchText) {
      sql += ` AND (
        content LIKE @searchLike OR filename LIKE @searchLike OR COALESCE(techPoint, '') LIKE @searchLike
      )`;
      params.searchLike = `%${searchText}%`;
    }
    sql += ' ORDER BY updatedAt DESC, rowid DESC';
    return this.db.prepare(sql).all(params);
  }

  getChunkById(id) {
    this.#assertLoaded();
    return this.db.prepare(`
      SELECT id, filename, content, position, domain, sourceType, createdAt, updatedAt,
             page, startPage, endPage, heading, type, techPoint, category, priority
      FROM chunks WHERE id = ?
    `).get(id) || null;
  }

  upsertChunk(data) {
    this.#assertLoaded();
    return this.#upsertChunk(data);
  }

  replaceAll(chunks) {
    this.#assertLoaded();
    const embeddings = chunks.map(chunk => normalizeEmbedding(chunk.embedding)).filter(Boolean);
    const dimension = embeddings[0]?.length || this.dimension;
    const tx = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM fts_chunks;
        DELETE FROM chunks;
        DROP TABLE IF EXISTS vec_chunks;
        DELETE FROM metadata WHERE key = 'vector_dimension';
      `);
      this.dimension = null;
      if (dimension) this.#ensureVectorTable(dimension);
      for (const chunk of chunks) this.#writeChunk(chunk);
    });
    tx();
  }

  #upsertChunk(data) {
    const tx = this.db.transaction(() => this.#writeChunk(data));
    tx();
    return this.getChunkById(data.id);
  }

  #writeChunk(data) {
    const now = Date.now();
    const embedding = normalizeEmbedding(data.embedding);
    const existing = this.db.prepare('SELECT rowid, vectorRowid FROM chunks WHERE id = ?').get(data.id);
    if (existing?.vectorRowid) {
      this.db.prepare('DELETE FROM vec_chunks WHERE rowid = ?').run(existing.vectorRowid);
    }

    let vectorRowid = null;
    if (embedding) {
      this.#ensureVectorTable(embedding.length);
      vectorRowid = Number(this.db.prepare('INSERT INTO vec_chunks(embedding) VALUES (?)').run(toVecParam(embedding)).lastInsertRowid);
    }

    this.db.prepare(`
      INSERT INTO chunks (
        id, filename, content, position, domain, sourceType, createdAt, updatedAt,
        page, startPage, endPage, heading, type, techPoint, category, priority, vectorRowid
      ) VALUES (
        @id, @filename, @content, @position, @domain, @sourceType, @createdAt, @updatedAt,
        @page, @startPage, @endPage, @heading, @type, @techPoint, @category, @priority, @vectorRowid
      )
      ON CONFLICT(id) DO UPDATE SET
        filename = excluded.filename,
        content = excluded.content,
        position = excluded.position,
        domain = excluded.domain,
        sourceType = excluded.sourceType,
        updatedAt = excluded.updatedAt,
        page = excluded.page,
        startPage = excluded.startPage,
        endPage = excluded.endPage,
        heading = excluded.heading,
        type = excluded.type,
        techPoint = excluded.techPoint,
        category = excluded.category,
        priority = excluded.priority,
        vectorRowid = excluded.vectorRowid
    `).run({
      id: data.id,
      filename: data.filename || '手动添加',
      content: data.content || '',
      position: data.position || '',
      domain: data.domain || '',
      sourceType: data.sourceType || 'manual',
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
      page: data.page || null,
      startPage: data.startPage || null,
      endPage: data.endPage || null,
      heading: data.heading || null,
      type: data.type || null,
      techPoint: data.techPoint || null,
      category: data.category || null,
      priority: data.priority || null,
      vectorRowid,
    });

    const row = this.db.prepare('SELECT rowid FROM chunks WHERE id = ?').get(data.id);
    this.db.prepare('DELETE FROM fts_chunks WHERE rowid = ?').run(row.rowid);
    this.db.prepare('INSERT INTO fts_chunks(rowid, content, filename, techPoint) VALUES (?, ?, ?, ?)').run(
      row.rowid,
      data.content || '',
      data.filename || '手动添加',
      data.techPoint || '',
    );
  }

  deleteChunk(id) {
    this.#assertLoaded();
    const existing = this.db.prepare('SELECT rowid, vectorRowid FROM chunks WHERE id = ?').get(id);
    if (!existing) return false;
    const tx = this.db.transaction(() => this.#deleteChunkByRow(id, existing));
    tx();
    return true;
  }

  deleteByFilename(filename) {
    this.#assertLoaded();
    const rows = this.db.prepare('SELECT id FROM chunks WHERE filename = ?').all(filename);
    const tx = this.db.transaction(() => {
      for (const row of rows) {
        const existing = this.db.prepare('SELECT rowid, vectorRowid FROM chunks WHERE id = ?').get(row.id);
        if (existing) this.#deleteChunkByRow(row.id, existing);
      }
    });
    tx();
    return rows.length;
  }

  search({ query, queryEmbedding, topK = 5, position, includeMetrics = false } = {}) {
    this.#assertLoaded();
    const totalStart = Date.now();
    const candidates = new Map();

    const vectorStart = Date.now();
    const vectorResults = this.#searchVector(queryEmbedding, Math.max(topK * 3, 10));
    for (const result of vectorResults) {
      const similarity = 1 / (1 + Math.max(result.distance, 0));
      this.#mergeCandidate(candidates, result, {
        score: similarity * scorePosition(result, position),
        source: 'vec',
      });
    }
    const vectorLatencyMs = elapsedSince(vectorStart);

    const ftsStart = Date.now();
    const ftsResults = this.#searchFts(query, Math.max(topK * 3, 10));
    for (const result of ftsResults) {
      const bm25 = Math.abs(result.rank || 0);
      const score = (1 + bm25) * 0.85 * scorePosition(result, position);
      this.#mergeCandidate(candidates, result, { score, source: 'fts' });
    }
    const ftsLatencyMs = elapsedSince(ftsStart);

    const mergeStart = Date.now();
    const results = Array.from(candidates.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ vectorRowid, rank, distance, ...doc }) => doc);
    const mergeLatencyMs = elapsedSince(mergeStart);

    if (!includeMetrics) return results;

    return {
      results,
      metrics: this.#buildSearchMetrics({
        results,
        vectorResults,
        ftsResults,
        vectorLatencyMs,
        ftsLatencyMs,
        mergeLatencyMs,
        totalLatencyMs: elapsedSince(totalStart),
      }),
    };
  }

  #searchVector(queryEmbedding, limit) {
    const embedding = normalizeEmbedding(queryEmbedding);
    if (!embedding || !this.#hasVectorTable()) return [];
    return this.db.prepare(`
      SELECT c.id, c.filename, c.content, c.position, c.domain, c.sourceType,
             c.page, c.startPage, c.endPage, c.heading, c.type, c.techPoint, c.category,
             v.distance
      FROM vec_chunks v
      JOIN chunks c ON c.vectorRowid = v.rowid
      WHERE v.embedding MATCH @embedding AND k = @limit
    `).all({ embedding: toVecParam(embedding), limit });
  }

  #searchFts(query, limit) {
    const ftsQuery = normalizeFtsQuery(query);
    if (!ftsQuery) return [];
    try {
      return this.db.prepare(`
        SELECT c.id, c.filename, c.content, c.position, c.domain, c.sourceType,
               c.page, c.startPage, c.endPage, c.heading, c.type, c.techPoint, c.category,
               f.rank
        FROM fts_chunks f
        JOIN chunks c ON c.rowid = f.rowid
        WHERE fts_chunks MATCH @query
        ORDER BY f.rank
        LIMIT @limit
      `).all({ query: ftsQuery, limit });
    } catch {
      return [];
    }
  }

  #mergeCandidate(candidates, result, { score, source }) {
    const existing = candidates.get(result.id);
    if (existing) {
      existing.score += score;
      if (!existing.matchSources.includes(source)) existing.matchSources.push(source);
      return;
    }
    candidates.set(result.id, {
      ...result,
      score,
      matchSources: [source],
    });
  }

  #buildSearchMetrics({ results, vectorResults, ftsResults, vectorLatencyMs, ftsLatencyMs, mergeLatencyMs, totalLatencyMs }) {
    const top = results[0] || null;
    const topScore = top?.score || 0;
    return {
      searchStrategy: 'hybrid',
      resultCount: results.length,
      vectorResultCount: vectorResults.length,
      ftsResultCount: ftsResults.length,
      isHit: results.length > 0,
      isStrongHit: topScore >= 0.75,
      topScore,
      topMatchSources: top?.matchSources || [],
      topFilename: top?.filename || '',
      topDomain: top?.domain || '',
      timings: {
        vector: vectorLatencyMs,
        fts: ftsLatencyMs,
        merge: mergeLatencyMs,
        total: totalLatencyMs,
      },
    };
  }

  #deleteChunkByRow(id, existing) {
    this.db.prepare('DELETE FROM fts_chunks WHERE rowid = ?').run(existing.rowid);
    if (existing.vectorRowid) this.db.prepare('DELETE FROM vec_chunks WHERE rowid = ?').run(existing.vectorRowid);
    this.db.prepare('DELETE FROM chunks WHERE id = ?').run(id);
  }

  #createBaseSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        content TEXT NOT NULL,
        position TEXT NOT NULL DEFAULT '',
        domain TEXT NOT NULL DEFAULT '',
        sourceType TEXT NOT NULL DEFAULT 'manual',
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        page INTEGER,
        startPage INTEGER,
        endPage INTEGER,
        heading TEXT,
        type TEXT,
        techPoint TEXT,
        category TEXT,
        priority TEXT,
        vectorRowid INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_filename ON chunks(filename);
      CREATE INDEX IF NOT EXISTS idx_chunks_position_domain ON chunks(position, domain);

      CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
        content,
        filename,
        techPoint,
        tokenize = 'trigram'
      );
    `);
  }

  #ensureVectorTable(dimension) {
    if (this.#hasVectorTable()) {
      if (this.dimension !== dimension) {
        throw new Error(`Embedding dimension mismatch: expected ${this.dimension}, got ${dimension}`);
      }
      return;
    }
    this.dimension = dimension;
    this.db.exec(`CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[${dimension}])`);
    this.#setMeta('vector_dimension', String(dimension));
  }

  #hasVectorTable() {
    return Boolean(this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vec_chunks'").get());
  }

  #getMeta(key) {
    return this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key)?.value || null;
  }

  #setMeta(key, value) {
    this.db.prepare('INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  #assertLoaded() {
    if (!this.db) throw new Error('HybridKnowledgeStore is not loaded');
  }
}
