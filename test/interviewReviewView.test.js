import { describe, expect, it } from 'vitest';
import { buildReviewDetailHTML, buildSessionListItemHTML } from '../src/renderer/interviewReviews.js';

describe('interview review view helpers', () => {
  it('renders session list item with weak question and knowledge counts', () => {
    const html = buildSessionListItemHTML({
      id: 's1',
      title: '前端一面',
      startedAt: '2026-05-06T10:00:00.000Z',
      position: 'frontend',
      questionCount: 6,
      weakQuestionCount: 2,
      knowledgeCount: 2,
    });

    expect(html).toContain('前端一面');
    expect(html).toContain('6 题');
    expect(html).toContain('薄弱 2');
    expect(html).toContain('入库 2');
    expect(html).toContain('frontend');
  });

  it('marks sessions with no recognized questions in the list', () => {
    const html = buildSessionListItemHTML({
      id: 's0',
      title: '空复盘',
      questionCount: 0,
      weakQuestionCount: 0,
      knowledgeCount: 0,
    });

    expect(html).toContain('未识别到问题');
  });

  it('renders review detail with weak questions and advice', () => {
    const html = buildReviewDetailHTML({
      title: '前端一面',
      review: {
        summary: {
          totalQuestions: 3,
          weakQuestionCount: 2,
          unansweredCount: 1,
          partialCount: 1,
        },
        overallAdvice: '优先复习 React Hooks。',
        weakQuestions: [
          {
            question: 'useMemo 和 useCallback 的区别？',
            issue: '没有回答上来',
            answer: '这个不太清楚。',
            advice: '从缓存值和缓存函数两个角度回答。',
            score: 1,
            domain: 'frontend',
          },
        ],
      },
      knowledgeCount: 1,
    });

    expect(html).toContain('复盘概览');
    expect(html).toContain('3');
    expect(html).toContain('useMemo 和 useCallback');
    expect(html).toContain('没有回答上来');
    expect(html).toContain('从缓存值和缓存函数两个角度回答');
    expect(html).toContain('入库 1 条');
  });

  it('explains sessions with no recognized interviewer questions', () => {
    const html = buildReviewDetailHTML({
      title: '空复盘',
      review: {
        summary: { totalQuestions: 0, weakQuestionCount: 0, unansweredCount: 0 },
        overallAdvice: '本场没有识别到明确的面试官问题，建议检查是否开启了系统音频捕获。',
        weakQuestions: [],
      },
      knowledgeCount: 0,
    });

    expect(html).toContain('没有识别到明确的面试官问题');
    expect(html).toContain('开启系统音频');
  });
});
