import { generateEmbedding } from './gemini.js';
import { safePdfParse } from './safePdfParse.js';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

function cosineSimilarity(a, b) {
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
  }

  getStorePath() {
    if (!this.storePath) {
      const dir = path.join(app.getPath('userData'), 'pdf-store');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.storePath = path.join(dir, 'vectors.json');
    }
    return this.storePath;
  }

  load() {
    try {
      const p = this.getStorePath();
      if (fs.existsSync(p)) {
        this.documents = JSON.parse(fs.readFileSync(p, 'utf-8'));
        console.log(`[PDF] Loaded ${this.documents.length} chunks from local store`);
      }
    } catch (e) {
      console.error('[PDF] Failed to load store:', e);
      this.documents = [];
    }
  }

  save() {
    try {
      fs.writeFileSync(this.getStorePath(), JSON.stringify(this.documents));
    } catch (e) {
      console.error('[PDF] Failed to save store:', e);
    }
  }

  async uploadPDF(buffer, filename) {
    try {
      if (buffer.length > 10 * 1024 * 1024) throw new Error('File is too large (max 10MB)');

      const pdfData = await safePdfParse(buffer);
      if (!pdfData.text || pdfData.text.trim().length === 0) throw new Error('No text content found in PDF');

      const chunks = this.splitIntoChunks(pdfData, 150);
      const validChunks = chunks.filter(chunk => {
        const clean = chunk.content.trim().replace(/\s+/g, ' ');
        return clean.length > 20 && /[a-zA-Z0-9一-鿿]/.test(clean);
      });

      if (validChunks.length === 0) throw new Error('No valid text chunks found');

      // 先删除同名文件的旧数据
      this.documents = this.documents.filter(d => d.filename !== filename);

      let embedded = 0;
      for (let i = 0; i < validChunks.length; i++) {
        try {
          const content = validChunks[i].content.trim().replace(/\s+/g, ' ');
          const embedding = await generateEmbedding(content);
          this.documents.push({
            filename,
            content,
            embedding,
            page: validChunks[i].page,
            startPage: validChunks[i].startPage,
            endPage: validChunks[i].endPage,
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

      return {
        id: filename,
        title: filename.replace('.pdf', ''),
        chunks: embedded,
        pageCount: pdfData.numpages || 0,
      };
    } catch (error) {
      console.error('[PDF] Upload error:', error);
      return null;
    }
  }

  async searchSimilarContent(query, topK = 5) {
    try {
      if (this.documents.length === 0) return [];

      const queryEmbedding = await generateEmbedding(query);

      const scored = this.documents.map(doc => ({
        ...doc,
        score: cosineSimilarity(queryEmbedding, doc.embedding),
      }));

      scored.sort((a, b) => b.score - a.score);

      return scored.slice(0, topK).map(doc => ({
        content: doc.content,
        score: doc.score,
        metadata: { filename: doc.filename },
        source: `PDF: ${doc.filename}`,
        page: doc.page || 1,
        startPage: doc.startPage || 1,
        endPage: doc.endPage || 1,
      }));
    } catch (error) {
      console.error('[PDF] Search error:', error);
      return [];
    }
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
      if (!files.has(doc.filename)) {
        files.set(doc.filename, { filename: doc.filename, chunks: 0 });
      }
      files.get(doc.filename).chunks++;
    }
    return Array.from(files.values());
  }

  splitIntoChunks(pdfData, chunkSize) {
    const text = pdfData.text.replace(/\n{3,}/g, '\n\n').replace(/\s{3,}/g, ' ').trim();
    const sentences = text.split(/[.!?。！？]+/).filter(s => s.trim().length > 0);
    const chunks = [];
    const avgCharsPerPage = Math.ceil(text.length / (pdfData.numpages || 1));

    let currentChunk = '';
    let currentWordCount = 0;
    let chunkStartPos = 0;

    for (const sentence of sentences) {
      const words = sentence.trim().split(/\s+/).length;
      const sentenceText = sentence.trim() + '. ';

      if (currentWordCount + words > chunkSize && currentChunk.length > 0) {
        const chunkEnd = chunkStartPos + currentChunk.length;
        chunks.push({
          content: currentChunk.trim(),
          page: Math.max(1, Math.ceil(chunkStartPos / avgCharsPerPage)),
          startPage: Math.max(1, Math.ceil(chunkStartPos / avgCharsPerPage)),
          endPage: Math.min(pdfData.numpages || 1, Math.ceil(chunkEnd / avgCharsPerPage)),
        });
        chunkStartPos = chunkEnd;
        currentChunk = sentenceText;
        currentWordCount = words;
      } else {
        currentChunk += sentenceText;
        currentWordCount += words;
      }
    }

    if (currentChunk.trim().length > 0) {
      const chunkEnd = chunkStartPos + currentChunk.length;
      chunks.push({
        content: currentChunk.trim(),
        page: Math.max(1, Math.ceil(chunkStartPos / avgCharsPerPage)),
        startPage: Math.max(1, Math.ceil(chunkStartPos / avgCharsPerPage)),
        endPage: Math.min(pdfData.numpages || 1, Math.ceil(chunkEnd / avgCharsPerPage)),
      });
    }

    return chunks;
  }
}

export const pineconeService = new LocalVectorStore();
