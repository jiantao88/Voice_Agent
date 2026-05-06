import { extractQuestion, generateSearchQuery } from './questionExtractor.js';
import { pineconeService } from './pineconeService.js';
import { webSearchAgent } from './webSearch.js';
import { RagMetricsLogger } from './ragMetricsLogger.js';
import { app } from 'electron';
import path from 'node:path';
import crypto from 'node:crypto';

class RAGOrchestrator {
  #metricsLogger = null;

  async processTranscript(transcript, background, options = {}) {
    const { position, contextHint, debug } = options;
    const debugTrace = debug ? { timings: {} } : null;
    const totalStart = Date.now();
    const queryId = crypto.randomUUID();

    try {
      const qStart = Date.now();
      const extractedQuestion = extractQuestion(transcript);
      if (debugTrace) {
        debugTrace.timings.questionExtraction = Date.now() - qStart;
        debugTrace.extractedQuestion = extractedQuestion
          ? { question: extractedQuestion.question, confidence: extractedQuestion.confidence, method: extractedQuestion.method }
          : null;
      }

      let searchQuery = extractedQuestion?.question || generateSearchQuery(transcript);
      if (!searchQuery || searchQuery.length < 2) {
        if (debugTrace) debugTrace.searchQuery = searchQuery || '';
        return { extractedQuestion: null, context: { pdfResults: [], webResults: [], combinedContext: '', citations: [] }, searchPerformed: false, debugTrace };
      }

      const enhancedQuery = contextHint ? `${contextHint} ${searchQuery}` : searchQuery;
      if (debugTrace) {
        debugTrace.searchQuery = searchQuery;
        debugTrace.enhancedQuery = enhancedQuery;
        debugTrace.contextHint = contextHint || '';
        debugTrace.queryId = queryId;
      }

      const pdfStart = Date.now();
      const pdfResults = await pineconeService.searchSimilarContent(enhancedQuery, 5, { position }).catch(() => []);
      const searchMetrics = pineconeService.getLastSearchMetrics();
      const pdfLatencyMs = Date.now() - pdfStart;
      const skipWebSearch = Boolean(searchMetrics?.isStrongHit);

      let webSearchResponse = { results: [] };
      let webLatencyMs = 0;
      if (!skipWebSearch) {
        const webStart = Date.now();
        webSearchResponse = await webSearchAgent.searchWeb(searchQuery, 3).catch(() => ({ results: [] }));
        webLatencyMs = Date.now() - webStart;
      }

      const metricsEvent = searchMetrics
        ? this.#getMetricsLogger().recordSearch({
            queryId,
            position: position || '',
            ...searchMetrics,
          })
        : null;
      const todaySummary = this.#getMetricsLogger().getTodaySummary();
      if (debugTrace) {
        debugTrace.timings.pdfSearch = pdfLatencyMs;
        debugTrace.timings.webSearch = webLatencyMs;
        debugTrace.webSearchSkipped = skipWebSearch;
        debugTrace.webSearchSkipReason = skipWebSearch ? 'strong_kb_hit' : '';
        debugTrace.knowledgeMetrics = metricsEvent;
        debugTrace.knowledgeMetricsSummary = todaySummary;
        debugTrace.pdfResults = pdfResults.map(r => ({
          id: r.id, content: r.content.substring(0, 200), score: r.score,
          filename: r.metadata?.filename, position: r.position, domain: r.domain, page: r.page,
          matchSources: r.matchSources || [],
        }));
        debugTrace.webResults = (webSearchResponse.results || []).map(r => ({
          content: (r.snippet || '').substring(0, 200), score: r.score, link: r.link,
        }));
      }

      const context = this.combineContexts(pdfResults, webSearchResponse.results);

      if (debugTrace) {
        debugTrace.timings.total = Date.now() - totalStart;
        debugTrace.rankedResults = context.citations.map(c => ({
          sourceType: c.sourceType, filename: c.filename, score: c.score, contextSnippet: c.contextSnippet,
        }));
        debugTrace.promptContext = {
          contextLength: context.combinedContext.length,
          citationCount: context.citations.length,
        };
      }

      return { extractedQuestion, context, searchPerformed: true, debugTrace };
    } catch (error) {
      console.error('Error in RAG processing:', error);
      return { extractedQuestion: null, context: { pdfResults: [], webResults: [], combinedContext: '', citations: [] }, searchPerformed: false, debugTrace };
    }
  }

  combineContexts(pdfResults, webResults) {
    const allResults = [
      ...pdfResults.map(r => ({ ...r, type: 'pdf', priority: 1 })),
      ...webResults.map(r => ({ ...r, content: r.snippet, type: 'web', priority: 2 })),
    ];

    allResults.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.score - a.score;
    });

    const topResults = allResults.slice(0, 4);
    const contextParts = [];
    const citations = [];

    for (const result of topResults) {
      const content = result.content.substring(0, 500);
      const isPdf = result.type === 'pdf';
      const sourceType = isPdf ? '[PDF]' : '[WEB]';

      let pageInfo = '';
      if (isPdf && result.startPage && result.endPage && result.startPage !== result.endPage) {
        pageInfo = `Pages ${result.startPage}-${result.endPage}`;
      } else if (isPdf && result.page) {
        pageInfo = `Page ${result.page}`;
      }

      contextParts.push(`${sourceType}${pageInfo ? ` (${pageInfo})` : ''} ${content}`);

      citations.push({
        source: result.source,
        content,
        url: !isPdf ? result.link : undefined,
        score: result.score,
        sourceType: result.type,
        page: isPdf ? result.page : undefined,
        startPage: isPdf ? result.startPage : undefined,
        endPage: isPdf ? result.endPage : undefined,
        filename: isPdf ? result.metadata?.filename || result.source : undefined,
        pageRange: pageInfo,
        contextSnippet: content.substring(0, 150) + (content.length > 150 ? '...' : ''),
      });
    }

    return {
      pdfResults,
      webResults,
      combinedContext: contextParts.join('\n\n'),
      citations,
    };
  }

  async uploadPDF(buffer, filename) {
    return await pineconeService.uploadPDF(buffer, filename);
  }

  async deletePDF(filename) {
    return await pineconeService.deleteDocument(filename);
  }

  #getMetricsLogger() {
    if (!this.#metricsLogger) {
      this.#metricsLogger = new RagMetricsLogger({
        metricsDir: path.join(app.getPath('userData'), 'metrics'),
      });
    }
    return this.#metricsLogger;
  }
}

export const ragOrchestrator = new RAGOrchestrator();
