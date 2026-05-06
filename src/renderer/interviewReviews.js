function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildSessionListItemHTML(session) {
  const title = escapeHTML(session.title || '未命名面试');
  const position = session.position ? `<span class="review-session-tag">${escapeHTML(session.position)}</span>` : '';
  const questionCount = Number(session.questionCount || 0);
  const statsHTML = questionCount > 0
    ? `
      <span>${questionCount} 题</span>
      <span>薄弱 ${Number(session.weakQuestionCount || 0)}</span>
      <span>入库 ${Number(session.knowledgeCount || 0)}</span>
    `
    : `
      <span class="review-session-warning">未识别到问题</span>
      <span>入库 ${Number(session.knowledgeCount || 0)}</span>
    `;
  return `
    <div class="review-session-main">
      <div class="review-session-title">${title}</div>
      <div class="review-session-meta">${formatDate(session.startedAt)} ${position}</div>
    </div>
    <div class="review-session-stats">${statsHTML}</div>
  `;
}

export function buildReviewDetailHTML(session = {}) {
  const review = session.review || {};
  const summary = review.summary || {};
  const weakQuestions = review.weakQuestions || [];
  const noQuestionHint = Number(summary.totalQuestions || 0) === 0
    ? '<div class="review-no-question-hint">没有识别到明确的面试官问题。真实面试复盘建议开启系统音频捕获（对方声音），或确保转写里有面试官问句。</div>'
    : '';
  const weakHTML = weakQuestions.length > 0
    ? weakQuestions.map((item, index) => `
      <div class="review-weak-item">
        <div class="review-weak-head">
          <span class="review-weak-index">Q${index + 1}</span>
          <span class="review-weak-issue">${escapeHTML(item.issue || '待改进')}</span>
          <span class="review-weak-score">${Number(item.score || 0)}/5</span>
        </div>
        <div class="review-weak-question">${escapeHTML(item.question)}</div>
        ${item.answer ? `<div class="review-weak-answer"><span>本次回答</span>${escapeHTML(item.answer)}</div>` : '<div class="review-weak-answer muted">本次没有形成有效回答</div>'}
        <div class="review-weak-advice"><span>下次建议</span>${escapeHTML(item.advice || '')}</div>
        ${item.domain ? `<div class="review-weak-domain">${escapeHTML(item.domain)}</div>` : ''}
      </div>
    `).join('')
    : '<div class="review-empty">本场没有识别到薄弱问题。</div>';

  return `
    <div class="review-detail-summary">
      <div class="review-detail-title">复盘概览</div>
      <div class="review-summary-grid">
        <div><strong>${Number(summary.totalQuestions || 0)}</strong><span>问题数</span></div>
        <div><strong>${Number(summary.weakQuestionCount || 0)}</strong><span>薄弱</span></div>
        <div><strong>${Number(summary.unansweredCount || 0)}</strong><span>未答上</span></div>
        <div><strong>${Number(session.knowledgeCount || 0)}</strong><span>入库</span></div>
      </div>
      <div class="review-overall-advice">${escapeHTML(review.overallAdvice || '暂无整体建议。')}</div>
      ${noQuestionHint}
      <div class="review-knowledge-status">入库 ${Number(session.knowledgeCount || 0)} 条</div>
    </div>
    <div class="review-detail-title">薄弱问题</div>
    <div class="review-weak-list">${weakHTML}</div>
  `;
}

export function createInterviewReviews({ elements, electronAPI }) {
  const { reviewSessionList, reviewDetailPanel, reviewDetailTitle, reviewDetailContent,
    reviewRefreshBtn, reviewDetailClose } = elements;
  let currentSessions = [];
  let selectedSession = null;

  async function refreshReviewSessions() {
    if (!reviewSessionList) return;
    const result = await electronAPI.listInterviewSessions();
    const sessions = result.success ? result.sessions || [] : [];
    currentSessions = sessions;
    renderSessionList(sessions);
  }

  function renderSessionList(sessions) {
    reviewSessionList.innerHTML = '';
    if (sessions.length === 0) {
      reviewSessionList.innerHTML = '<div class="review-empty">录音结束后会在这里生成复盘。</div>';
      return;
    }
    for (const session of sessions) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `review-session-item${selectedSession?.id === session.id ? ' active' : ''}`;
      item.innerHTML = buildSessionListItemHTML(session);
      item.addEventListener('click', () => openReviewDetail(session.id));
      reviewSessionList.appendChild(item);

      if (selectedSession?.id === session.id) {
        const detail = document.createElement('div');
        detail.className = 'review-inline-detail';
        detail.innerHTML = `
          <div class="review-detail-header">
            <h3>${escapeHTML(selectedSession.title || '面试复盘')}</h3>
            <button class="small-btn" type="button" data-review-close>收起</button>
          </div>
          <div class="review-detail-content">${buildReviewDetailHTML(selectedSession)}</div>
        `;
        detail.querySelector('[data-review-close]').addEventListener('click', closeReviewDetail);
        reviewSessionList.appendChild(detail);
      }
    }
  }

  async function openReviewDetail(sessionId) {
    if (selectedSession?.id === sessionId) {
      closeReviewDetail();
      return;
    }
    const result = await electronAPI.getInterviewSession(sessionId);
    if (!result.success) {
      selectedSession = {
        id: sessionId,
        title: '复盘加载失败',
        review: { overallAdvice: result.error || '未知错误', weakQuestions: [], summary: {} },
      };
      renderSessionList(currentSessions);
      return;
    }
    selectedSession = result.session;
    renderSessionList(currentSessions);
  }

  function closeReviewDetail() {
    selectedSession = null;
    renderSessionList(currentSessions);
    reviewDetailPanel?.classList.add('hidden');
  }

  reviewRefreshBtn?.addEventListener('click', refreshReviewSessions);
  reviewDetailClose?.addEventListener('click', closeReviewDetail);

  return {
    refreshReviewSessions,
    openReviewDetail,
    closeReviewDetail,
  };
}
