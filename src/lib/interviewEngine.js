import { streamChat, queryChat } from './gemini.js';
import { ragOrchestrator } from './ragOrchestrator.js';
import {
  buildPrompt, buildKnowledgeCheckPrompt, buildRAGPrompt,
  buildSummarizerPrompt, buildInterviewerPrompt, buildQuestionRecommendPrompt,
} from './prompts.js';

class InterviewEngine {
  async process(text, mode, background, send) {
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
      const responseText = await queryChat([
        { role: 'system', content: '你是一位资深技术面试官，请用中文回答。' },
        { role: 'user', content: buildQuestionRecommendPrompt(background, text) },
      ], process.env.MAIN_MODEL);
      send('ai-stream', responseText);
      send('ai-stream-end', { citations: [] });
      return;
    }

    await this.#copilot(text, background, send);
  }

  async #copilot(text, background, send) {
    const checkText = await queryChat([
      { role: 'user', content: buildKnowledgeCheckPrompt(text) },
    ]);

    if (checkText.startsWith('KNOWN:')) {
      await this.#stream(send, [
        { role: 'system', content: '你是一位专业的面试助手，帮助面试者回答技术问题。请用中文回答，简洁有条理。' },
        { role: 'user', content: buildPrompt(background, text) },
      ]);
      send('ai-stream-end', { citations: [] });
      return;
    }

    const ragResponse = await ragOrchestrator.processTranscript(text, background, { debug: true });
    const extractedQ = ragResponse.extractedQuestion?.question || text;
    send('ai-question', extractedQ);

    if (ragResponse.debugTrace) {
      send('rag-debug', ragResponse.debugTrace);
    }

    if (ragResponse.searchPerformed && ragResponse.context.combinedContext) {
      await this.#stream(send, [
        { role: 'system', content: '你是一位专业的面试助手。基于提供的上下文和你的知识，给出最全面准确的回答。请用中文回答。' },
        { role: 'user', content: buildRAGPrompt(background, text, extractedQ, ragResponse.context.combinedContext) },
      ]);
      send('ai-stream-end', { citations: ragResponse.context.citations });
    } else {
      await this.#stream(send, [
        { role: 'system', content: '你是一位专业的面试助手，帮助面试者回答技术问题。请用中文回答，简洁有条理。' },
        { role: 'user', content: buildPrompt(background, text) },
      ]);
      send('ai-stream-end', { citations: [] });
    }
  }

  async #stream(send, messages) {
    const model = process.env.MAIN_MODEL || 'vtrix-gemini-3-flash-preview';
    const stream = await streamChat(messages, model);
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) send('ai-stream', content);
    }
  }
}

export const interviewEngine = new InterviewEngine();
