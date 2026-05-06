import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { InterviewSessionStore } from '../src/lib/interviewSessionStore.js';

describe('InterviewSessionStore', () => {
  const cleanup = [];

  afterEach(() => {
    while (cleanup.length) {
      rmSync(cleanup.pop(), { recursive: true, force: true });
    }
  });

  it('persists an interview session with segment upserts and review result', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'vtt-interview-sessions-'));
    cleanup.push(dir);
    const storePath = path.join(dir, 'sessions.json');
    const store = new InterviewSessionStore({ storePath });

    const session = store.startSession({ position: 'backend', mode: 'candidate' });
    store.recordSegment({ id: 1, source: 'system', text: 'Redis 为什么快？', finalized: false });
    store.recordSegment({ id: 1, source: 'system', text: 'Redis 为什么快？', finalized: true });
    store.recordSegment({ id: 2, source: 'mic', text: '因为是内存。', finalized: true });
    store.recordAIInteraction({ question: 'Redis 为什么快？', answer: '可从内存、IO 多路复用、数据结构回答。' });

    const ended = store.endSession(session.id, {
      review: { summary: { totalQuestions: 1 }, weakQuestions: [] },
      knowledgeCount: 0,
    });
    const reloaded = new InterviewSessionStore({ storePath });
    const saved = reloaded.getSession(session.id);

    expect(ended.endedAt).toBeTruthy();
    expect(saved.segments).toHaveLength(2);
    expect(saved.aiInteractions).toHaveLength(1);
    expect(saved.review.summary.totalQuestions).toBe(1);
  });

  it('reuses an active session instead of creating duplicates', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'vtt-interview-sessions-'));
    cleanup.push(dir);
    const store = new InterviewSessionStore({ storePath: path.join(dir, 'sessions.json') });

    const first = store.startSession({ position: 'frontend' });
    const second = store.startSession({ position: 'frontend' });

    expect(second.id).toBe(first.id);
    expect(store.listSessions()).toHaveLength(0);
  });

  it('hides empty reviews and supports discarding them', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'vtt-interview-sessions-'));
    cleanup.push(dir);
    const store = new InterviewSessionStore({ storePath: path.join(dir, 'sessions.json') });

    const empty = store.startSession({ position: 'frontend' });
    store.endSession(empty.id, {
      review: { summary: { totalQuestions: 0, weakQuestionCount: 0 }, weakQuestions: [] },
      knowledgeCount: 0,
    });
    const useful = store.startSession({ position: 'frontend' });
    store.endSession(useful.id, {
      review: { summary: { totalQuestions: 2, weakQuestionCount: 1 }, weakQuestions: [{}] },
      knowledgeCount: 1,
    });

    expect(store.listSessions()).toHaveLength(1);
    expect(store.listSessions()[0].id).toBe(useful.id);

    store.discardSession(useful.id);
    expect(store.listSessions()).toHaveLength(0);
  });
});
