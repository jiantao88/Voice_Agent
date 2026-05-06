const QUESTION_PATTERNS = [
  /[?？]/,
  /什么|为什么|如何|怎么|怎样|区别|原理|机制|流程|介绍|讲一下|说一下|聊一下|解释|设计/,
];

const WEAK_ANSWER_PATTERNS = [
  /不会|不清楚|不太清楚|不了解|没了解|没用过|不知道|忘了|答不上来/,
];

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isInterviewerSegment(segment) {
  return segment?.source === 'system' || segment?.speaker === 'interviewer';
}

function isCandidateSegment(segment) {
  return segment?.source === 'mic' || segment?.source === 'default' || segment?.speaker === 'candidate';
}

function isQuestion(text) {
  const normalized = normalizeText(text);
  if (normalized.length < 4) return false;
  return QUESTION_PATTERNS.some(pattern => pattern.test(normalized));
}

function classifyAnswer(answer) {
  const normalized = normalizeText(answer);
  if (!normalized || normalized.length < 6) return 'unanswered';
  if (WEAK_ANSWER_PATTERNS.some(pattern => pattern.test(normalized))) return 'unanswered';
  if (normalized.length < 80) return 'partial';
  return 'answered';
}

export function matchInterviewQuestions(segments = []) {
  const pairs = [];
  let current = null;

  for (const segment of segments) {
    const text = normalizeText(segment.text);
    if (!text) continue;

    if (isInterviewerSegment(segment) && isQuestion(text)) {
      if (current) pairs.push(finalizePair(current));
      current = {
        questionId: segment.id,
        question: text,
        askedAt: segment.timestamp || segment.createdAt || '',
        answerParts: [],
      };
      continue;
    }

    if (current && isCandidateSegment(segment)) {
      current.answerParts.push(text);
    }
  }

  if (current) pairs.push(finalizePair(current));
  return pairs;
}

function finalizePair(pair) {
  const answer = pair.answerParts.join('\n').trim();
  return {
    questionId: pair.questionId,
    question: pair.question,
    askedAt: pair.askedAt,
    answer,
    status: classifyAnswer(answer),
    answerLength: normalizeText(answer).length,
  };
}
