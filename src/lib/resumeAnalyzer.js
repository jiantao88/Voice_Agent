import { streamChat, queryChat } from './gemini.js';
import { safePdfParse } from './safePdfParse.js';
import { pineconeService } from './pineconeService.js';
import { generateEmbedding } from './gemini.js';

class ResumeAnalyzer {
  async process(buffer, filename, send) {
    try {
      // Step 1: 解析 PDF
      send('progress', { step: 1, total: 4, message: `正在解析 ${filename}...` });
      const pdfData = await safePdfParse(buffer);
      const text = pdfData.text?.trim();
      if (!text) throw new Error('PDF 中没有提取到文本内容');
      send('progress', { step: 1, total: 4, message: `解析完成，共 ${pdfData.numpages || '?'} 页`, done: true });

      // Step 2: AI 分析技术点
      send('progress', { step: 2, total: 4, message: '正在分析技术栈和面试要点...' });
      const analysis = await this.analyzeTechStack(text, send);
      send('progress', { step: 2, total: 4, message: `分析完成，发现 ${analysis.techPoints.length} 个技术点`, done: true });

      // Step 3: 生成知识文档
      send('progress', { step: 3, total: 4, message: '正在生成技术知识文档...' });
      const knowledgeDocs = await this.generateKnowledgeBase(analysis, text, send);
      send('progress', { step: 3, total: 4, message: `知识文档生成完成，共 ${knowledgeDocs.length} 篇`, done: true });

      // Step 4: 向量化存储
      send('progress', { step: 4, total: 4, message: '正在存储到知识库...' });
      await this.storeKnowledge(filename, knowledgeDocs, send);
      send('progress', { step: 4, total: 4, message: '知识库存储完成', done: true });

      send('complete', {
        filename,
        techStack: analysis.techStack,
        techPoints: analysis.techPoints,
        knowledgeCount: knowledgeDocs.length,
        pageCount: pdfData.numpages || 0,
      });

      return { success: true };
    } catch (error) {
      console.error('[ResumeAnalyzer] Error:', error);
      send('error', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  async analyzeTechStack(resumeText, send) {
    const truncated = resumeText.substring(0, 6000);

    const content = await queryChat([
      {
        role: 'system',
        content: `你是一位资深技术面试专家。分析简历内容，提取技术信息。
必须返回纯 JSON（不要 markdown 代码块），格式：
{
  "techStack": ["技术1", "技术2"],
  "summary": "一句话概括候选人背景",
  "techPoints": [
    {"topic": "具体技术面试点", "category": "分类", "priority": "high/medium/low"}
  ]
}
要求：
- techPoints 提取 10-15 个最可能被面试官问到的技术点
- topic 要具体，比如"React 虚拟 DOM 原理与 Diff 算法"而不是"React"
- priority: high=核心技术必问, medium=有可能问, low=加分项`,
      },
      { role: 'user', content: truncated },
    ], process.env.MAIN_MODEL);

    try {
      const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(clean);
      send('analysis', result);
      return result;
    } catch (e) {
      console.error('[ResumeAnalyzer] Failed to parse analysis:', e, '\nRaw:', content);
      throw new Error('AI 分析结果解析失败，请重试');
    }
  }

  async generateKnowledgeBase(analysis, resumeText, send) {
    const docs = [];
    const summaryContext = resumeText.substring(0, 2000);
    const points = analysis.techPoints || [];

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      send('progress', {
        step: 3,
        total: 4,
        message: `正在生成知识文档 (${i + 1}/${points.length}): ${point.topic}`,
      });

      try {
        const stream = await streamChat([
          {
            role: 'system',
            content: `你是一位技术面试教练。为面试技术点生成简明参考答案。
要求：结构清晰、重点突出、适合面试时快速回顾、中文回答。
控制在 200-400 字。`,
          },
          {
            role: 'user',
            content: `技术点：${point.topic}\n分类：${point.category}\n候选人背景：${analysis.summary || ''}\n\n请生成面试参考答案。`,
          },
        ], process.env.MAIN_MODEL);

        let answer = '';
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
            answer += text;
            send('knowledge-stream', { index: i, topic: point.topic, chunk: text });
          }
        }

        docs.push({
          topic: point.topic,
          category: point.category,
          priority: point.priority,
          content: answer,
        });

        send('knowledge-done', { index: i, topic: point.topic, content: answer });
      } catch (e) {
        console.error(`[ResumeAnalyzer] Failed to generate for "${point.topic}":`, e);
      }
    }

    return docs;
  }

  async storeKnowledge(filename, docs, send) {
    for (let i = 0; i < docs.length; i++) {
      try {
        const doc = docs[i];
        const textForEmbedding = `${doc.topic}: ${doc.content}`;
        const embedding = await generateEmbedding(textForEmbedding);

        pineconeService.documents.push({
          filename,
          type: 'knowledge',
          techPoint: doc.topic,
          category: doc.category,
          priority: doc.priority,
          content: doc.content,
          embedding,
        });

        send('progress', {
          step: 4,
          total: 4,
          message: `存储知识点 (${i + 1}/${docs.length}): ${doc.topic}`,
        });

        if (i > 0 && i % 3 === 0) await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        console.error(`[ResumeAnalyzer] Failed to store "${docs[i].topic}":`, e);
      }
    }

    pineconeService.save();
  }
}

export const resumeAnalyzer = new ResumeAnalyzer();
