const QUESTION_PATTERNS = [
  { pattern: /(?:请你|请|能不能|你能|可以)?(?:说说|讲讲|介绍一下|解释一下|谈谈|聊聊)(?:一下)?(.+?)(?:吗|呢|吧)?[？?。]?$/m, confidence: 0.9 },
  { pattern: /(?:什么是|如何|怎么|为什么|为啥|哪些|怎样|怎么样)(.+?)(?:呢|吗|的)?[？?。]?$/m, confidence: 0.85 },
  { pattern: /(.+?)(?:是什么|是啥|怎么实现|怎么做|有什么区别|有哪些|原理是什么|优缺点|的区别)[？?。]?$/m, confidence: 0.85 },
  { pattern: /(?:谈谈|聊聊)(?:你对)?(.+?)(?:的理解|的看法|的认识)[？?。]?$/m, confidence: 0.8 },
  { pattern: /(?:你觉得|你认为|你怎么看)(.+?)(?:呢|吗)?[？?。]?$/m, confidence: 0.75 },
  { pattern: /(?:描述一下|说一下|讲一下|简述|详细说说)(.+)/m, confidence: 0.75 },
  { pattern: /(?:如果|假如|假设)(.+?)[，,](?:你会|应该|怎么)(.+?)(?:呢|吗)?[？?。]?$/m, confidence: 0.7, composite: true },
  { pattern: /(?:what|how|why|when|where|which)\s+(?:is|are|do|does|did|was|were|will|would|could|should)\s+(.+)/i, confidence: 0.6 },
  { pattern: /(?:can you|could you|would you)\s+(?:explain|tell|describe|help)\s+(?:me\s+)?(?:with\s+)?(.+)/i, confidence: 0.6 },
  { pattern: /(?:tell me|explain|describe)\s+(?:about\s+)?(.+)/i, confidence: 0.5 },
];

const CN_STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都',
  '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会',
  '着', '没有', '看', '好', '自己', '这', '他', '她', '它', '们',
  '那', '些', '什么', '怎么', '哪', '吗', '呢', '吧', '啊', '呀',
  '嗯', '然后', '但是', '如果', '因为', '所以', '可以', '这个', '那个',
  '还', '能', '把', '被', '比', '从', '对', '而', '跟', '给', '让',
]);

const EN_STOP_WORDS = new Set([
  'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'about', 'into', 'through', 'during', 'before',
  'after', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have',
  'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'can', 'may', 'might', 'shall', 'must', 'i', 'me', 'my', 'you', 'your',
  'he', 'she', 'it', 'we', 'they', 'this', 'that', 'these', 'those',
  'a', 'an', 'not', 'no', 'so', 'if', 'as', 'just', 'also', 'very',
]);

function extractLocally(transcript) {
  let bestMatch = null;
  for (const { pattern, confidence, composite } of QUESTION_PATTERNS) {
    const match = transcript.match(pattern);
    if (!match || !match[1]) continue;

    let questionText = composite && match[2]
      ? `${match[1].trim()} ${match[2].trim()}`
      : match[1].trim();

    if (questionText.length < 2) continue;
    questionText = questionText.replace(/\s+/g, ' ').replace(/[,，;；]+$/, '').trim();

    const result = {
      question: questionText,
      context: transcript.substring(Math.max(0, match.index - 50), match.index + match[0].length + 50),
      confidence,
    };
    if (!bestMatch || confidence > bestMatch.confidence) bestMatch = result;
  }
  return bestMatch;
}

export function extractQuestion(transcript) {
  const local = extractLocally(transcript);
  if (local && local.confidence >= 0.5) {
    return { ...local, method: 'local' };
  }
  return null;
}

export function generateSearchQuery(transcript) {
  const cnWords = (transcript.match(/[一-鿿]{2,}/g) || [])
    .filter(w => !CN_STOP_WORDS.has(w));

  const enWords = transcript
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !EN_STOP_WORDS.has(w) && !/^\d+$/.test(w));

  const combined = [...new Set([...cnWords, ...enWords])].slice(0, 8);
  return combined.join(' ');
}
