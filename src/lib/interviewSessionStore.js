import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app } from 'electron';

function defaultStorePath() {
  const baseDir = app?.getPath ? app.getPath('userData') : process.cwd();
  return path.join(baseDir, 'interview-review', 'sessions.json');
}

function compactSession(session) {
  return {
    id: session.id,
    title: session.title,
    position: session.position,
    mode: session.mode,
    startedAt: session.startedAt,
    endedAt: session.endedAt || '',
    segmentCount: session.segments?.length || 0,
    questionCount: session.review?.summary?.totalQuestions || 0,
    weakQuestionCount: session.review?.summary?.weakQuestionCount || 0,
    knowledgeCount: session.knowledgeCount || 0,
  };
}

export class InterviewSessionStore {
  constructor({ storePath } = {}) {
    this.storePath = storePath;
    this.sessions = null;
    this.activeSessionId = null;
  }

  startSession({ position = '', mode = 'candidate', title = '' } = {}) {
    this.#load();
    const now = new Date().toISOString();
    const session = {
      id: crypto.randomUUID(),
      title: title || `面试复盘 ${new Date().toLocaleString('zh-CN')}`,
      position,
      mode,
      startedAt: now,
      endedAt: '',
      segments: [],
      aiInteractions: [],
      review: null,
      knowledgeCount: 0,
    };
    this.sessions.unshift(session);
    this.activeSessionId = session.id;
    this.#save();
    return session;
  }

  recordSegment(segment, sessionId = this.activeSessionId) {
    this.#load();
    const session = this.getSession(sessionId);
    if (!session || !segment) return null;
    const text = String(segment.text || '');
    if (!text.trim() && segment.action !== 'start') return session;

    const key = String(segment.id ?? `${segment.source || 'default'}-${Date.now()}`);
    const existingIndex = session.segments.findIndex(item => String(item.id) === key);
    const next = {
      id: key,
      source: segment.source || 'default',
      speaker: segment.speaker || '',
      text,
      timestamp: segment.timestamp || '',
      finalized: Boolean(segment.finalized),
      updatedAt: new Date().toISOString(),
    };
    if (existingIndex >= 0) {
      session.segments[existingIndex] = { ...session.segments[existingIndex], ...next };
    } else {
      session.segments.push({ ...next, createdAt: new Date().toISOString() });
    }
    this.#save();
    return session;
  }

  recordAIInteraction(interaction, sessionId = this.activeSessionId) {
    this.#load();
    const session = this.getSession(sessionId);
    if (!session || !interaction) return null;
    session.aiInteractions.push({
      id: crypto.randomUUID(),
      question: String(interaction.question || ''),
      answer: String(interaction.answer || ''),
      citations: interaction.citations || [],
      createdAt: new Date().toISOString(),
    });
    this.#save();
    return session;
  }

  endSession(sessionId = this.activeSessionId, { review = null, knowledgeCount = 0 } = {}) {
    this.#load();
    const session = this.getSession(sessionId);
    if (!session) return null;
    session.endedAt = new Date().toISOString();
    session.review = review;
    session.knowledgeCount = knowledgeCount;
    if (this.activeSessionId === session.id) this.activeSessionId = null;
    this.#save();
    return session;
  }

  getActiveSession() {
    this.#load();
    return this.activeSessionId ? this.getSession(this.activeSessionId) : null;
  }

  getSession(id) {
    this.#load();
    return this.sessions.find(session => session.id === id) || null;
  }

  listSessions() {
    this.#load();
    return this.sessions.map(compactSession);
  }

  #path() {
    if (!this.storePath) this.storePath = defaultStorePath();
    return this.storePath;
  }

  #load() {
    if (this.sessions) return;
    const p = this.#path();
    try {
      if (!fs.existsSync(p)) {
        this.sessions = [];
        return;
      }
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      this.sessions = Array.isArray(data.sessions) ? data.sessions : [];
      this.activeSessionId = data.activeSessionId || null;
    } catch (error) {
      console.error('[InterviewSessionStore] Failed to load sessions:', error);
      this.sessions = [];
      this.activeSessionId = null;
    }
  }

  #save() {
    const p = this.#path();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      activeSessionId: this.activeSessionId,
      sessions: this.sessions,
    }));
  }
}

export const interviewSessionStore = new InterviewSessionStore();
