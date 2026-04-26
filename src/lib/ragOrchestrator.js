import { extractQuestionFromTranscript } from './questionExtractor.js';
import { extractQuestionLocally, generateSearchQuery } from './localQuestionExtractor.js';
import { pineconeService } from './pineconeService.js';
import { webSearchAgent } from './webSearch.js';

class RAGOrchestrator {
  async processTranscript(transcript, background) {
    try {
      let extractedQuestion = null;
      try {
        extractedQuestion = await extractQuestionFromTranscript(transcript);
        if (!extractedQuestion || extractedQuestion.confidence < 0.4) extractedQuestion = null;
      } catch (error) {
        const localQuestion = extractQuestionLocally(transcript);
        if (localQuestion && localQuestion.confidence >= 0.5) {
          extractedQuestion = localQuestion;
        }
      }

      let searchQuery = extractedQuestion?.question || generateSearchQuery(transcript);
      if (!searchQuery || searchQuery.length < 10) {
        return { extractedQuestion: null, context: { pdfResults: [], webResults: [], combinedContext: '', citations: [] }, searchPerformed: false };
      }

      const [pdfResults, webSearchResponse] = await Promise.all([
        pineconeService.searchSimilarContent(searchQuery, 3).catch(() => []),
        webSearchAgent.searchWeb(searchQuery, 3).catch(() => ({ results: [] })),
      ]);

      const context = this.combineContexts(pdfResults, webSearchResponse.results);
      return { extractedQuestion, context, searchPerformed: true };
    } catch (error) {
      console.error('Error in RAG processing:', error);
      return { extractedQuestion: null, context: { pdfResults: [], webResults: [], combinedContext: '', citations: [] }, searchPerformed: false };
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
