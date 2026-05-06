import { generateEmbedding } from './gemini.js';
import { safePdfParse } from './safePdfParse.js';
import { splitPdfIntoChunks, splitMarkdownByHeadings } from './chunkSplitter.js';
import { HybridKnowledgeStore } from './hybridKnowledgeStore.js';
import { EmbeddingCache } from './embeddingCache.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app } from 'electron';

function isValidEmbedding(embedding) {
  return Array.isArray(embedding) && embedding.length > 0 && embedding.every(n => Number.isFinite(n));
}

function cosineSimilarity(a, b) {
  if (!isValidEmbedding(a) || !isValidEmbedding(b) || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

class LocalVectorStore {
  constructor() {
    this.documents = [];
    this.storePath = null;
    this.hybridStore = null;
    this.embeddingCache = null;
    this.lastSearchMetrics = null;
  }

  getStorePath() {
    if (!this.storePath) {
      const dir = path.join(app.getPath('userData'), 'pdf-store');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.storePath = path.join(dir, 'vectors.json');
    }
    return this.storePath;
  }

  getGroupsPath() {
    const dir = path.join(app.getPath('userData'), 'pdf-store');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'groups.json');
  }

  getIndexPath() {
    const dir = path.join(app.getPath('userData'), 'pdf-store');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'knowledge.sqlite');
  }

  getEmbeddingCachePath() {
    const dir = path.join(app.getPath('userData'), 'pdf-store');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'query-embeddings.json');
  }

  load() {
    try {
      const p = this.getStorePath();
      if (fs.existsSync(p)) {
        this.documents = JSON.parse(fs.readFileSync(p, 'utf-8'));
        let migrated = false;
        for (const doc of this.documents) {
          if (!doc.id) { doc.id = crypto.randomUUID(); migrated = true; }
          if (!doc.sourceType) { doc.sourceType = 'pdf'; migrated = true; }
          if (!doc.createdAt) { doc.createdAt = Date.now(); migrated = true; }
          if (!doc.updatedAt) { doc.updatedAt = Date.now(); migrated = true; }
          if (doc.group !== undefined && doc.position === undefined) {
            doc.position = '';
            doc.domain = doc.group || '';
            delete doc.group;
            migrated = true;
          }
          if (doc.position === undefined) { doc.position = ''; migrated = true; }
          if (doc.domain === undefined) { doc.domain = ''; migrated = true; }
        }
        if (migrated) this.save();
        console.log(`[PDF] Loaded ${this.documents.length} chunks from local store`);
      }
    } catch (e) {
      console.error('[PDF] Failed to load store:', e);
      this.documents = [];
    }
    this.#ensureHybridStore();
    this.#syncHybridIndex();
  }

  save() {
    try {
      const p = this.getStorePath();
      fs.writeFileSync(p, JSON.stringify(this.documents));
      this.#syncHybridIndex();
      console.log(`[PDF] Saved ${this.documents.length} chunks to ${p}`);
    } catch (e) {
      console.error('[PDF] Failed to save store:', e);
    }
  }

  async uploadPDF(buffer, filename) {
    try {
      if (buffer.length > 10 * 1024 * 1024) throw new Error('File is too large (max 10MB)');

      const pdfData = await safePdfParse(buffer);
      if (!pdfData.text || pdfData.text.trim().length === 0) throw new Error('No text content found in PDF');

      const chunks = splitPdfIntoChunks(pdfData, 150);
      const validChunks = chunks.filter(chunk => {
        const clean = chunk.content.trim().replace(/\s+/g, ' ');
        return clean.length > 20 && /[a-zA-Z0-9一-鿿]/.test(clean);
      });

      if (validChunks.length === 0) throw new Error('No valid text chunks found');

      this.documents = this.documents.filter(d => d.filename !== filename);

      let embedded = 0;
      for (let i = 0; i < validChunks.length; i++) {
        try {
          const content = validChunks[i].content.trim().replace(/\s+/g, ' ');
          const embedding = await generateEmbedding(content);
          this.documents.push({
            id: crypto.randomUUID(), position: '', domain: '', sourceType: 'pdf',
            createdAt: Date.now(), updatedAt: Date.now(),
            filename, content, embedding,
            page: validChunks[i].page, startPage: validChunks[i].startPage, endPage: validChunks[i].endPage,
          });
          embedded++;
          if (i > 0 && i % 5 === 0) await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.error(`[PDF] Failed embedding chunk ${i}:`, e);
        }
      }

      if (embedded === 0) throw new Error('No embeddings generated');
      this.save();
      console.log(`[PDF] Uploaded ${filename}: ${embedded} chunks`);

      return { id: filename, title: filename.replace('.pdf', ''), chunks: embedded, pageCount: pdfData.numpages || 0 };
    } catch (error) {
      console.error('[PDF] Upload error:', error);
      return null;
    }
  }

  async uploadMarkdown(text, filename) {
    try {
      this.documents = this.documents.filter(d => d.filename !== filename);
      const chunks = splitMarkdownByHeadings(text);
      const validChunks = chunks.filter(c => c.content.trim().length > 20);

      if (validChunks.length === 0) throw new Error('No valid sections found in Markdown');

      let embedded = 0;
      for (let i = 0; i < validChunks.length; i++) {
        try {
          const content = validChunks[i].content.trim();
          const embedding = await generateEmbedding(content);
          this.documents.push({
            id: crypto.randomUUID(), position: '', domain: '', sourceType: 'markdown',
            createdAt: Date.now(), updatedAt: Date.now(),
            filename, content, embedding, heading: validChunks[i].heading,
          });
          embedded++;
          if (i > 0 && i % 5 === 0) await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.error(`[MD] Failed embedding chunk ${i}:`, e);
        }
      }

      if (embedded === 0) throw new Error('No embeddings generated');
      this.save();
      console.log(`[MD] Uploaded ${filename}: ${embedded} chunks`);
      return { id: filename, title: filename.replace('.md', ''), chunks: embedded };
    } catch (error) {
      console.error('[MD] Upload error:', error);
      return null;
    }
  }

  async searchSimilarContent(query, topK = 5, options = {}) {
    try {
      this.lastSearchMetrics = null;
      let docs = this.documents;
      if (docs.length === 0) return [];

      const embeddingStart = Date.now();
      let embeddingResult = { embedding: null, cacheHit: false };
      let embeddingError = null;
      try {
        embeddingResult = await this.#ensureEmbeddingCache().getOrCreate(query, () => generateEmbedding(query));
      } catch (error) {
        embeddingError = error;
        console.warn('[PDF] Embedding unavailable, falling back to FTS5:', error.message);
      }
      const queryEmbedding = embeddingResult.embedding;
      const embeddingLatencyMs = Date.now() - embeddingStart;
      const activePosition = options.position || '';

      this.#ensureHybridStore();
      const hybridSearch = this.hybridStore?.search({
        query,
        queryEmbedding,
        topK,
        position: activePosition,
        includeMetrics: true,
      }) || { results: [], metrics: null };
      const hybridResults = hybridSearch.results || [];
      this.lastSearchMetrics = hybridSearch.metrics
        ? {
            ...hybridSearch.metrics,
            embeddingCacheHit: embeddingResult.cacheHit,
            embeddingFailed: Boolean(embeddingError),
            embeddingError: embeddingError?.code || embeddingError?.message || '',
            timings: {
              embedding: embeddingLatencyMs,
              ...hybridSearch.metrics.timings,
              total: embeddingLatencyMs + (hybridSearch.metrics.timings?.total || 0),
            },
          }
        : null;

      if (hybridResults.length > 0) {
        return hybridResults.map(doc => ({
          id: doc.id,
          content: doc.content,
          score: doc.score,
          metadata: { filename: doc.filename },
          source: `PDF: ${doc.filename}`,
          page: doc.page || 1,
          startPage: doc.startPage || 1,
          endPage: doc.endPage || 1,
          position: doc.position || '',
          domain: doc.domain || '',
          matchSources: doc.matchSources || [],
        }));
      }

      if (!isValidEmbedding(queryEmbedding)) {
        return [];
      }

      const scored = docs.map(doc => {
        let score = cosineSimilarity(queryEmbedding, doc.embedding);
        if (activePosition && doc.position === activePosition) {
          score *= 1.3;
        } else if (doc.position === 'common') {
          score *= 1.15;
        }
        return { ...doc, score };
      });

      scored.sort((a, b) => b.score - a.score);

      const fallbackResults = scored.slice(0, topK);
      const top = fallbackResults[0] || null;
      this.lastSearchMetrics = {
        searchStrategy: 'vector_fallback',
        resultCount: fallbackResults.length,
        vectorResultCount: fallbackResults.length,
        ftsResultCount: 0,
        isHit: fallbackResults.length > 0,
        isStrongHit: (top?.score || 0) >= 0.75,
        topScore: top?.score || 0,
        topMatchSources: fallbackResults.length > 0 ? ['vec'] : [],
        topFilename: top?.filename || '',
        topDomain: top?.domain || '',
        embeddingCacheHit: embeddingResult.cacheHit,
        embeddingFailed: Boolean(embeddingError),
        embeddingError: embeddingError?.code || embeddingError?.message || '',
        timings: { embedding: embeddingLatencyMs, vector: 0, fts: 0, merge: 0, total: embeddingLatencyMs },
      };

      return fallbackResults.map(doc => ({
        id: doc.id, content: doc.content, score: doc.score,
        metadata: { filename: doc.filename },
        source: `PDF: ${doc.filename}`,
        page: doc.page || 1, startPage: doc.startPage || 1, endPage: doc.endPage || 1,
        position: doc.position || '', domain: doc.domain || '',
      }));
    } catch (error) {
      console.error('[PDF] Search error:', error);
      return [];
    }
  }

  getLastSearchMetrics() {
    return this.lastSearchMetrics;
  }

  async deleteDocument(filename) {
    const before = this.documents.length;
    this.documents = this.documents.filter(d => d.filename !== filename);
    this.save();
    console.log(`[PDF] Deleted ${filename}: removed ${before - this.documents.length} chunks`);
    return true;
  }

  getUploadedFiles() {
    const files = new Map();
    for (const doc of this.documents) {
      if (!files.has(doc.filename)) files.set(doc.filename, { filename: doc.filename, chunks: 0 });
      files.get(doc.filename).chunks++;
    }
    return Array.from(files.values());
  }

  // --- Chunk CRUD ---

  getChunks({ filename, position, domain, searchText } = {}) {
    let results = this.documents;
    if (filename) results = results.filter(d => d.filename === filename);
    if (position) results = results.filter(d => d.position === position);
    if (domain) results = results.filter(d => d.domain === domain);
    if (searchText) {
      const lower = searchText.toLowerCase();
      results = results.filter(d =>
        d.content.toLowerCase().includes(lower) ||
        d.filename.toLowerCase().includes(lower) ||
        (d.techPoint && d.techPoint.toLowerCase().includes(lower))
      );
    }
    return results.map(({ embedding, ...rest }) => rest);
  }

  getChunkById(id) {
    const doc = this.documents.find(d => d.id === id);
    if (!doc) return null;
    const { embedding, ...rest } = doc;
    return rest;
  }

  async updateChunk(id, updates) {
    const doc = this.documents.find(d => d.id === id);
    if (!doc) return null;

    const contentChanged = updates.content && updates.content !== doc.content;
    if (updates.content) doc.content = updates.content;
    if (updates.position !== undefined) doc.position = updates.position;
    if (updates.domain !== undefined) doc.domain = updates.domain;
    doc.updatedAt = Date.now();

    if (contentChanged) doc.embedding = await generateEmbedding(doc.content);

    this.save();
    const { embedding, ...rest } = doc;
    return rest;
  }

  deleteChunk(id) {
    const before = this.documents.length;
    this.documents = this.documents.filter(d => d.id !== id);
    if (this.documents.length < before) { this.save(); return true; }
    return false;
  }

  async addChunk({ content, position = '', domain = '', filename = '手动添加', sourceType = 'manual' }) {
    const embedding = await generateEmbedding(content);
    const now = Date.now();
    const doc = { id: crypto.randomUUID(), position, domain, sourceType, createdAt: now, updatedAt: now, filename, content, embedding };
    this.documents.push(doc);
    this.save();
    const { embedding: _, ...rest } = doc;
    return rest;
  }

  setDocumentGroup(filename, position, domain) {
    let count = 0;
    for (const doc of this.documents) {
      if (doc.filename === filename) {
        doc.position = position;
        doc.domain = domain;
        doc.updatedAt = Date.now();
        count++;
      }
    }
    if (count > 0) this.save();
    return count;
  }

  // --- Groups ---

  getGroups() {
    try {
      const p = this.getGroupsPath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (Array.isArray(data)) {
          const migrated = this.#defaultGroups();
          if (data.length > 0) {
            const common = migrated.positions.find(p => p.id === 'common');
            for (const g of data) {
              if (!common.domains.some(d => d.name === g.name)) {
                common.domains.push({ id: g.name.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '-'), name: g.name });
              }
            }
          }
          this.saveGroups(migrated);
          return migrated;
        }
        if (data.positions && data.positions.length > 0) return data;
      }
    } catch (e) {
      console.error('[PDF] Failed to load groups:', e);
    }
    const defaults = this.#defaultGroups();
    this.saveGroups(defaults);
    return defaults;
  }

  #defaultGroups() {
    return {
      positions: [
        { id: 'frontend', name: '前端', domains: [] },
        { id: 'backend', name: '后端', domains: [] },
        { id: 'common', name: '通用', domains: [] },
      ],
    };
  }

  saveGroups(groups) {
    try {
      fs.writeFileSync(this.getGroupsPath(), JSON.stringify(groups));
    } catch (e) {
      console.error('[PDF] Failed to save groups:', e);
    }
  }

  classifyCategory(category) {
    const POSITION_KEYWORDS = {
      frontend: ['react', 'vue', 'angular', 'css', 'html', 'webpack', 'vite', 'typescript', 'javascript', 'js', 'ts', '前端', '浏览器', 'dom', 'node'],
      backend: ['java', 'spring', 'mysql', 'redis', 'kafka', 'rabbitmq', 'mybatis', 'jvm', '后端', 'golang', 'go', 'python', 'django', 'flask', 'microservice', '微服务', 'docker', 'k8s', 'kubernetes', 'nginx', 'rpc', 'dubbo'],
      common: ['系统设计', '算法', '数据结构', 'http', 'tcp', 'udp', '网络', '操作系统', 'os', 'linux', '设计模式', 'git', '安全'],
    };
    const lower = category.toLowerCase();
    for (const [posId, keywords] of Object.entries(POSITION_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) return posId;
    }
    return 'common';
  }

  reclassifyUnassigned() {
    const groups = this.getGroups();
    let count = 0;

    for (const doc of this.documents) {
      if (doc.position && doc.position !== '') continue;
      const cat = doc.category || doc.techPoint || '';
      if (!cat) continue;

      const positionId = this.classifyCategory(cat);
      const domainId = cat.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

      doc.position = positionId;
      doc.domain = domainId;
      doc.updatedAt = Date.now();
      count++;

      let pos = groups.positions.find(p => p.id === positionId);
      if (!pos) {
        pos = { id: positionId, name: positionId === 'frontend' ? '前端' : positionId === 'backend' ? '后端' : '通用', domains: [] };
        groups.positions.push(pos);
      }
      if (!pos.domains.some(d => d.id === domainId)) {
        pos.domains.push({ id: domainId, name: cat });
      }
    }

    if (count > 0) {
      this.save();
      this.saveGroups(groups);
    }
    return count;
  }

  #ensureHybridStore() {
    if (this.hybridStore) return;
    try {
      const firstEmbedding = this.documents.find(d => isValidEmbedding(d.embedding))?.embedding;
      this.hybridStore = new HybridKnowledgeStore({
        dbPath: this.getIndexPath(),
        dimension: firstEmbedding?.length,
      });
      this.hybridStore.load();
    } catch (e) {
      console.error('[PDF] Failed to initialize hybrid index:', e);
      this.hybridStore = null;
    }
  }

  #ensureEmbeddingCache() {
    if (!this.embeddingCache) {
      this.embeddingCache = new EmbeddingCache({
        cachePath: this.getEmbeddingCachePath(),
        maxEntries: 500,
      });
    }
    return this.embeddingCache;
  }

  #syncHybridIndex() {
    if (!this.hybridStore) return;
    try {
      this.hybridStore.replaceAll(this.documents);
    } catch (e) {
      console.error('[PDF] Failed to sync hybrid index:', e);
    }
  }
}

export const pineconeService = new LocalVectorStore();
