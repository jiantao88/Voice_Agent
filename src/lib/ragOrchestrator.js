import { extractQuestion, generateSearchQuery } from './questionExtractor.js';
import { pineconeService } from './pineconeService.js';
import { webSearchAgent } from './webSearch.js';

class RAGOrchestrator {
  async processTranscript(transcript, background, options = {}) {
    const { group, debug } = options;
    const debugTrace = debug ? { timings: {} } : null;
    const totalStart = Date.now();

    try {
      const qStart = Date.now();
      const extractedQuestion = await extractQuestion(transcript);
      if (debugTrace) {
        debugTrace.timings.questionExtraction = Date.now() - qStart;
        debugTrace.extractedQuestion = extractedQuestion
          ? { question: extractedQuestion.question, confidence: extractedQuestion.confidence, method: extractedQuestion.method }
          : null;
      }

      let searchQuery = extractedQuestion?.question || generateSearchQuery(transcript);
      if (!searchQuery || searchQuery.length < 10) {
        if (debugTrace) debugTrace.searchQuery = searchQuery || '';
        return { extractedQuestion: null, context: { pdfResults: [], webResults: [], combinedContext: '', citations: [] }, searchPerformed: false, debugTrace };
      }
      if (debugTrace) debugTrace.searchQuery = searchQuery;

      const pdfStart = Date.now();
      const webStart = Date.now();
      const [pdfResults, webSearchResponse] = await Promise.all([
        pineconeService.searchSimilarContent(searchQuery, 3, { group }).catch(() => []),
        webSearchAgent.searchWeb(searchQuery, 3).catch(() => ({ results: [] })),
      ]);
      if (debugTrace) {
        debugTrace.timings.pdfSearch = Date.now() - pdfStart;
        debugTrace.timings.webSearch = Date.now() - webStart;
        debugTrace.pdfResults = pdfResults.map(r => ({
          id: r.id, content: r.content.substring(0, 200), score: r.score,
          filename: r.metadata?.filename, group: r.group, page: r.page,
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
}

export const ragOrchestrator = new RAGOrchestrator();
