import { queryChat } from './gemini.js';

const QUESTION_PATTERNS = [
  { pattern: /(?:interviewer|they|he|she)\s+(?:asked|asks|asking)\s+(?:me\s+)?(?:about\s+)?([^.?!]+(?:\?|\.|\!)?)/i, confidence: 0.9 },
  { pattern: /(?:the\s+)?question\s+(?:was|is)\s+(?:about\s+)?([^.?!]+(?:\?|\.|\!)?)/i, confidence: 0.8 },
  { pattern: /(?:they|he|she)\s+wanted\s+to\s+know\s+(?:about\s+)?([^.?!]+(?:\?|\.|\!)?)/i, confidence: 0.8 },
  { pattern: /(?:asked|asking)\s+(?:me\s+)?(?:to\s+)?(?:explain|describe|tell|discuss)\s+([^.?!]+)/i, confidence: 0.7 },
  { pattern: /(?:can\s+you|could\s+you|would\s+you)\s+(?:explain|tell|describe|help)\s+(?:me\s+)?(?:with\s+)?([^.?!]+)/i, confidence: 0.7 },
  { pattern: /(?:what|how|why|when|where|which|who)\s+(?:is|are|do|does|did|was|were|will|would|could|should)\s+([^.?!]+)/i, confidence: 0.6 },
  { pattern: /(?:what|how|why|when|where|which|who)\s+([^.?!]+)/i, confidence: 0.5 },
  { pattern: /(?:tell\s+me|explain|describe)\s+(?:about\s+)?([^.?!]+)/i, confidence: 0.5 },
];

const STOP_WORDS = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'should', 'now', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'would', 'could', 'should', 'ought', 'might', 'must']);

function extractLocally(transcript) {
  let bestMatch = null;
  for (const { pattern, confidence } of QUESTION_PATTERNS) {
    const match = transcript.match(pattern);
    if (!match || !match[1]) continue;
    const questionText = match[1].trim();
    if (questionText.length < 5 || /^(it|that|this|yes|no|ok|okay)$/i.test(questionText)) continue;

    const cleanQuestion = questionText.replace(/\s+/g, ' ').replace(/[,;]+$/, '').trim();
    const result = {
      question: cleanQuestion.charAt(0).toUpperCase() + cleanQuestion.slice(1),
      context: transcript.substring(Math.max(0, match.index - 50), match.index + match[0].length + 50),
      confidence,
    };
    if (!bestMatch || confidence > bestMatch.confidence) bestMatch = result;
  }
  return bestMatch;
}

async function extractViaLLM(transcript) {
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
  if (extracted.confidence > 0.3 && extracted.question.trim()) return extracted;
  return null;
}

export async function extractQuestion(transcript) {
  try {
    const result = await extractViaLLM(transcript);
    if (result && result.confidence >= 0.4) {
      return { ...result, method: 'cloud' };
    }
  } catch {
    // cloud failed — fall through to local
  }

  const local = extractLocally(transcript);
  if (local && local.confidence >= 0.5) {
    return { ...local, method: 'local' };
  }

  return null;
}

export function generateSearchQuery(transcript) {
  const words = transcript
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  return Array.from(new Set(words)).slice(0, 5).join(' ');
}
