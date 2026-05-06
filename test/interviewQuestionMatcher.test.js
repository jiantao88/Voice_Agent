import { describe, expect, it } from 'vitest';
import { matchInterviewQuestions } from '../src/lib/interviewQuestionMatcher.js';

describe('matchInterviewQuestions', () => {
  it('pairs interviewer questions with following candidate answers', () => {
    const pairs = matchInterviewQuestions([
      { id: 1, source: 'system', text: '请说一下 React Hooks 的原理？', timestamp: '10:00:01' },
      { id: 2, source: 'mic', text: 'Hooks 是函数组件里使用状态和副作用的机制。', timestamp: '10:00:08' },
      { id: 3, source: 'mic', text: '比如 useState 保存状态，useEffect 处理副作用。', timestamp: '10:00:13' },
      { id: 4, source: 'system', text: '那 useMemo 和 useCallback 有什么区别？', timestamp: '10:00:30' },
      { id: 5, source: 'mic', text: '这个我不太清楚。', timestamp: '10:00:35' },
    ]);

    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({
      question: '请说一下 React Hooks 的原理？',
      answer: 'Hooks 是函数组件里使用状态和副作用的机制。\n比如 useState 保存状态，useEffect 处理副作用。',
      status: 'partial',
    });
    expect(pairs[1]).toMatchObject({
      question: '那 useMemo 和 useCallback 有什么区别？',
      status: 'unanswered',
    });
  });

  it('marks interviewer questions without a candidate answer as unanswered', () => {
    const pairs = matchInterviewQuestions([
      { id: 'q1', source: 'system', text: '浏览器缓存机制怎么理解？', timestamp: '11:00:01' },
      { id: 'q2', source: 'system', text: '继续说一下协商缓存？', timestamp: '11:00:20' },
    ]);

    expect(pairs).toHaveLength(2);
    expect(pairs[0].status).toBe('unanswered');
    expect(pairs[0].answer).toBe('');
    expect(pairs[1].status).toBe('unanswered');
  });
});
