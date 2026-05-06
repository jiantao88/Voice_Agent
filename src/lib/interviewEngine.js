import { streamChat } from './gemini.js';
import { ragOrchestrator } from './ragOrchestrator.js';
import { conversationBuffer } from './conversationBuffer.js';
import { interviewSessionStore } from './interviewSessionStore.js';
import {
  buildPrompt, buildContextualRAGPrompt,
  buildSummarizerPrompt, buildInterviewerPrompt, buildQuestionRecommendPrompt,
} from './prompts.js';

class InterviewEngine {
  #activePosition = '';

  setActivePosition(position) {
    this.#activePosition = position;
  }

  async process(text, mode, background, send, options = {}) {
    const position = options.position || this.#activePosition;

    if (mode === 'summarizer') {
      await this.#stream(send, [{ role: 'user', content: buildSummarizerPrompt(text) }]);
      send('ai-stream-end', { citations: [] });
      return;
    }

    if (mode === 'interviewer-evaluate') {
      await this.#stream(send, [
        { role: 'system', content: '你是一位资深技术面试官，请用中文回答。' },
        { role: 'user', content: buildInterviewerPrompt(background, '', text) },
      ]);
      send('ai-stream-end', { citations: [] });
      return;
    }

    if (mode === 'interviewer-recommend') {
      await this.#stream(send, [
        { role: 'system', content: '你是一位资深技术面试官，请用中文回答。' },
        { role: 'user', content: buildQuestionRecommendPrompt(background, text) },
      ]);
      send('ai-stream-end', { citations: [] });
      return;
    }

    await this.#copilot(text, background, send, position);
  }

  async #copilot(text, background, send, position) {
    conversationBuffer.addTurn('user', text);
    const contextHint = conversationBuffer.getSearchHint();
    const history = conversationBuffer.getRecentContext();

    const ragResponse = await ragOrchestrator.processTranscript(text, background, {
      position,
      contextHint,
      debug: true,
    });

    const extractedQ = ragResponse.extractedQuestion?.question || text;
    send('ai-question', extractedQ);

    if (ragResponse.debugTrace) {
      send('rag-debug', ragResponse.debugTrace);
    }

    let fullResponse = '';
    let llmMetrics = null;
    let citations = [];
    if (ragResponse.searchPerformed && ragResponse.context.combinedContext) {
      citations = ragResponse.context.citations;
      fullResponse = await this.#stream(send, [
        { role: 'system', content: '你是一位专业的面试助手。基于提供的上下文和你的知识，给出最全面准确的回答。请用中文回答。' },
        { role: 'user', content: buildContextualRAGPrompt(background, text, history, extractedQ, ragResponse.context.combinedContext) },
      ], { onMetrics: metrics => { llmMetrics = metrics; } });
      this.#sendRagTimingUpdate(send, ragResponse.debugTrace, llmMetrics);
      send('ai-stream-end', { citations });
    } else {
      fullResponse = await this.#stream(send, [
        { role: 'system', content: '你是一位专业的面试助手，帮助面试者回答技术问题。请用中文回答，简洁有条理。' },
        { role: 'user', content: buildPrompt(background, text) },
      ], { onMetrics: metrics => { llmMetrics = metrics; } });
      this.#sendRagTimingUpdate(send, ragResponse.debugTrace, llmMetrics);
      send('ai-stream-end', { citations: [] });
    }

    interviewSessionStore.recordAIInteraction({ question: extractedQ, answer: fullResponse, citations });
    conversationBuffer.addTurn('assistant', fullResponse);
  }

  async #stream(send, messages, options = {}) {
    const model = process.env.MAIN_MODEL || 'vtrix-gemini-3-flash-preview';
    const requestStart = Date.now();
    const stream = await streamChat(messages, model);
    const streamOpenLatency = Date.now() - requestStart;
    let full = '';
    let firstTokenLatency = null;
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        if (firstTokenLatency === null) firstTokenLatency = Date.now() - requestStart;
        send('ai-stream', content);
        full += content;
      }
    }
    options.onMetrics?.({
      model,
      streamOpen: streamOpenLatency,
      firstToken: firstTokenLatency ?? Date.now() - requestStart,
      total: Date.now() - requestStart,
      outputChars: full.length,
    });
    return full;
  }

  #sendRagTimingUpdate(send, debugTrace, llmMetrics) {
    if (!debugTrace || !llmMetrics) return;
    debugTrace.llmMetrics = llmMetrics;
    send('rag-debug', debugTrace);
  }
}

export const interviewEngine = new InterviewEngine();
