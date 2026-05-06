import { matchInterviewQuestions } from './interviewQuestionMatcher.js';

function inferDomain(question) {
  const text = String(question || '').toLowerCase();
  if (/react|hooks|dom|css|浏览器|前端|vue|webpack|vite/.test(text)) return 'frontend';
  if (/redis|mysql|spring|java|数据库|缓存|消息队列|kafka|后端/.test(text)) return 'backend';
  if (/算法|数据结构|网络|http|tcp|操作系统|系统设计/.test(text)) return 'common';
  return 'interview_review';
}

function statusLabel(status) {
  if (status === 'answered') return '答得较完整';
  if (status === 'partial') return '回答不完整';
  return '没有回答上来';
}

function scoreForStatus(status) {
  if (status === 'answered') return 5;
  if (status === 'partial') return 3;
  return 1;
}

function buildAdvice(pair) {
  if (pair.status === 'answered') {
    return '下次可以继续保持，并补充项目例子或关键原理，让答案更有说服力。';
  }
  if (pair.status === 'partial') {
    return '下次回答时先给结论，再补充原理、使用场景、优缺点和项目例子。';
  }
  return '下次遇到类似问题时，先复述问题，再按定义、原理、场景、例子四步组织答案。';
}

function buildKnowledgeContent(pair) {
  return [
    `面试问题：${pair.question}`,
    `本次表现：${statusLabel(pair.status)}`,
    pair.answer ? `用户回答：${pair.answer}` : '用户回答：未形成有效回答',
    `下次回答建议：${buildAdvice(pair)}`,
  ].join('\n\n');
}

export function buildInterviewReview(session) {
  const pairs = matchInterviewQuestions(session?.segments || []);
  const weakQuestions = pairs
    .filter(pair => pair.status !== 'answered')
    .map(pair => ({
      ...pair,
      score: scoreForStatus(pair.status),
      issue: statusLabel(pair.status),
      advice: buildAdvice(pair),
      domain: inferDomain(pair.question),
    }));

  const answeredCount = pairs.filter(pair => pair.status === 'answered').length;
  const partialCount = pairs.filter(pair => pair.status === 'partial').length;
  const unansweredCount = pairs.filter(pair => pair.status === 'unanswered').length;

  const knowledgeCards = weakQuestions.map(pair => ({
    sourceType: 'interview_review',
    position: session?.position || '',
    domain: pair.domain,
    question: pair.question,
    status: pair.status,
    score: pair.score,
    content: buildKnowledgeContent(pair),
  }));

  return {
    sessionId: session?.id || '',
    generatedAt: new Date().toISOString(),
    summary: {
      totalQuestions: pairs.length,
      answeredCount,
      partialCount,
      unansweredCount,
      weakQuestionCount: weakQuestions.length,
    },
    questionReviews: pairs.map(pair => ({
      ...pair,
      score: scoreForStatus(pair.status),
      issue: statusLabel(pair.status),
      advice: buildAdvice(pair),
      domain: inferDomain(pair.question),
    })),
    weakQuestions,
    knowledgeCards,
    overallAdvice: buildOverallAdvice({ pairs, weakQuestions, partialCount, unansweredCount }),
  };
}

function buildOverallAdvice({ pairs, weakQuestions, partialCount, unansweredCount }) {
  if (pairs.length === 0) return '本场没有识别到明确的面试官问题，建议检查是否开启了系统音频捕获。';
  if (weakQuestions.length === 0) return '本场问题整体回答较完整，后续重点提升表达结构和项目案例细节。';
  return `本场识别到 ${weakQuestions.length} 个薄弱问题，其中 ${unansweredCount} 个没有回答上来，${partialCount} 个回答不完整。建议优先复习这些问题，并按“结论-原理-场景-例子”准备答案。`;
}
