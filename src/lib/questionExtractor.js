import { queryChat } from './gemini.js';

export async function extractQuestionFromTranscript(transcript) {
  try {
    const content = await queryChat([
      {
        role: 'system',
        content: `你是一个面试问题提取器。从面试转写文本中提取最近的、需要回答的面试问题。
返回 JSON：{"question": "提取的问题", "context": "简要上下文", "confidence": 0.95}
如果没有明确问题：{"question": "", "context": "", "confidence": 0}
只返回 JSON，不要其他内容。`,
      },
      { role: 'user', content: transcript },
    ]);

    const clean = content.replace(/```json\n?/, '').replace(/```\n?$/, '').trim();
    const extracted = JSON.parse(clean);

    if (extracted.confidence > 0.3 && extracted.question.trim()) {
      return extracted;
    }
    return null;
  } catch (error) {
    console.error('Error extracting question:', error);
    return null;
  }
}
