import { describe, expect, it } from 'vitest';
import { buildInterviewReview } from '../src/lib/interviewReviewAnalyzer.js';

describe('buildInterviewReview', () => {
  it('summarizes weak and unanswered interview questions', () => {
    const review = buildInterviewReview({
      id: 'session-1',
      position: 'frontend',
      startedAt: '2026-05-06T10:00:00.000Z',
      endedAt: '2026-05-06T10:30:00.000Z',
      segments: [
        { id: 1, source: 'system', text: '讲一下事件循环？', timestamp: '10:00:01' },
        { id: 2, source: 'mic', text: '宏任务和微任务。', timestamp: '10:00:08' },
        { id: 3, source: 'system', text: '虚拟 DOM diff 怎么做？', timestamp: '10:02:01' },
        { id: 4, source: 'mic', text: '这个我没了解过。', timestamp: '10:02:08' },
      ],
    });

    expect(review.summary.totalQuestions).toBe(2);
    expect(review.summary.unansweredCount).toBe(1);
    expect(review.summary.partialCount).toBe(1);
    expect(review.weakQuestions).toHaveLength(2);
    expect(review.knowledgeCards[0]).toMatchObject({
      sourceType: 'interview_review',
      position: 'frontend',
    });
    expect(review.knowledgeCards[0].content).toContain('下次回答建议');
  });
});
