import { marked } from 'marked';

function pct(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function ms(value) {
  return `${Math.round(value || 0)}ms`;
}

function labelMatchSources(sources = []) {
  const hasFts = sources.includes('fts');
  const hasVec = sources.includes('vec');
  if (hasFts && hasVec) return 'FTS + 向量';
  if (hasFts) return 'FTS';
  if (hasVec) return '向量';
  return '无';
}

function hitLabel(metrics) {
  if (!metrics?.isHit) return '未命中';
  return metrics.isStrongHit ? '强命中' : '弱命中';
}

function latencyWidth(value, max) {
  if (!value || !max) return 0;
  return Math.max(3, Math.min(100, Math.round((value / max) * 100)));
}

function latencyRow({ label, value, detail, skipped }, max) {
  const width = latencyWidth(value, max);
  const valueLabel = skipped ? '已跳过' : ms(value);
  const detailHTML = detail ? `<span class="rag-latency-detail">${detail}</span>` : '';
  return `
    <div class="rag-latency-row${skipped ? ' skipped' : ''}">
      <div class="rag-latency-label">${label}${detailHTML}</div>
      <div class="rag-latency-track"><div class="rag-latency-fill" style="width:${skipped ? 0 : width}%"></div></div>
      <strong class="rag-latency-value">${valueLabel}</strong>
    </div>
  `;
}

function buildLatencyWaterfallHTML(trace = {}) {
  const timings = trace.timings || {};
  const metrics = trace.knowledgeMetrics || {};
  const knowledgeTimings = metrics.timings || {};
  const llm = trace.llmMetrics || {};
  const rows = [
    { label: '问题提取', value: timings.questionExtraction },
    {
      label: 'Embedding',
      value: knowledgeTimings.embedding,
      detail: metrics.embeddingCacheHit ? '缓存命中' : '实时生成',
    },
    { label: 'FTS5', value: knowledgeTimings.fts },
    { label: '向量检索', value: knowledgeTimings.vector },
    { label: '结果合并', value: knowledgeTimings.merge },
    {
      label: 'Web 搜索',
      value: timings.webSearch,
      skipped: trace.webSearchSkipped,
      detail: trace.webSearchSkipped ? '强命中跳过' : '',
    },
    { label: 'RAG 总计', value: timings.total },
    { label: 'LLM 首 token', value: llm.firstToken },
    { label: 'LLM 总耗时', value: llm.total, detail: llm.model || '' },
  ].filter(row => row.skipped || Number.isFinite(Number(row.value)));

  if (rows.length === 0) return '';
  const max = Math.max(...rows.map(row => Number(row.value || 0)), 1);

  return `
    <div class="rag-latency-waterfall">
      <div class="rag-metric-heading">耗时瀑布</div>
      ${rows.map(row => latencyRow(row, max)).join('')}
    </div>
  `;
}

export function buildRAGMetricsSummaryHTML(trace = {}) {
  const metrics = trace.knowledgeMetrics;
  const summary = trace.knowledgeMetricsSummary;
  const waterfallHTML = buildLatencyWaterfallHTML(trace);
  if (!metrics && !summary && !waterfallHTML) return '';

  const topScore = metrics?.topScore ? pct(metrics.topScore) : '0%';
  const sourceLabel = labelMatchSources(metrics?.topMatchSources || []);
  const cacheLabel = metrics?.embeddingCacheHit ? '命中' : '未命中';
  const webLabel = trace.webSearchSkipped ? '强命中跳过' : ms(trace.timings?.webSearch);

  return `
    <div class="rag-metrics-card">
      <div class="rag-metrics-title">知识库命中概览</div>
      <div class="rag-metrics-grid">
        <div class="rag-metric-block">
          <div class="rag-metric-heading">本次检索</div>
          <div class="rag-metric-row"><span>命中状态</span><strong>${hitLabel(metrics)}</strong></div>
          <div class="rag-metric-row"><span>Top 分数</span><strong>${topScore}</strong></div>
          <div class="rag-metric-row"><span>命中来源</span><strong>${sourceLabel}</strong></div>
          <div class="rag-metric-row"><span>返回结果</span><strong>${metrics?.resultCount || 0} 条</strong></div>
          <div class="rag-metric-row"><span>总耗时</span><strong>${ms(metrics?.timings?.total)}</strong></div>
          <div class="rag-metric-row"><span>Embedding 缓存</span><strong>${cacheLabel}</strong></div>
          <div class="rag-metric-row"><span>Web 搜索</span><strong>${webLabel}</strong></div>
        </div>
        <div class="rag-metric-block">
          <div class="rag-metric-heading">今日统计</div>
          <div class="rag-metric-row"><span>检索次数</span><strong>${summary?.searchCount || 0}</strong></div>
          <div class="rag-metric-row"><span>知识库</span><strong>命中率 ${pct(summary?.hitRate)}</strong></div>
          <div class="rag-metric-row"><span>强命中率</span><strong>${pct(summary?.strongHitRate)}</strong></div>
          <div class="rag-metric-row"><span>缓存命中率</span><strong>${pct(summary?.embeddingCacheHitRate)}</strong></div>
          <div class="rag-metric-row"><span>平均耗时</span><strong>${ms(summary?.avgLatencyMs)}</strong></div>
          <div class="rag-metric-row"><span>延迟分位</span><strong>P95 ${ms(summary?.p95LatencyMs)}</strong></div>
        </div>
      </div>
      ${waterfallHTML}
    </div>
  `;
}

export function createAIChat({ elements, electronAPI, getSelectedText, getCurrentMode, getActivePosition, addToHistory }) {
  const { aiQuestion, aiResponse, aiCitations, triggerAIBtn, interviewerResponse, jdInput,
    recommendQuestionsBtn, evaluateAnswerBtn, ragDebugPanel, ragDebugToggle, ragDebugContent,
    agentPanel, agentSteps, agentContent, pdfStatus } = elements;

  let isAIProcessing = false;
  let aiStreamText = '';
  let agentKnowledgeText = {};

  triggerAIBtn.addEventListener('click', () => {
    const text = getSelectedText();
    if (text.trim()) requestAICompletion(text);
  });

  recommendQuestionsBtn.addEventListener('click', async () => {
    if (isAIProcessing) return;
    isAIProcessing = true;
    interviewerResponse.innerHTML = '';
    interviewerResponse.classList.add('loading');
    aiStreamText = '';
    const resume = getSelectedText() || '';
    await electronAPI.aiCompletion(jdInput.value || '通用技术面试', 'interviewer-recommend', resume);
  });

  evaluateAnswerBtn.addEventListener('click', () => {
    const text = getSelectedText();
    if (text.trim()) requestAICompletion(text);
  });

  async function requestAICompletion(text) {
    if (isAIProcessing) return;
    isAIProcessing = true;
    triggerAIBtn.disabled = true;
    aiResponse.innerHTML = '';
    aiResponse.classList.add('loading');
    aiQuestion.classList.remove('visible');
    aiCitations.innerHTML = '';
    aiStreamText = '';
    ragDebugPanel.classList.add('hidden');
    ragDebugContent.innerHTML = '';

    const mode = getCurrentMode() === 'candidate' ? 'copilot' : 'interviewer-evaluate';
    const background = getCurrentMode() === 'interviewer' ? jdInput.value : '';
    const position = getActivePosition();
    await electronAPI.aiCompletion(text, mode, background, position);
  }

  // --- IPC listeners ---
  electronAPI.onAIStream((chunk) => {
    aiResponse.classList.remove('loading');
    const target = getCurrentMode() === 'candidate' ? aiResponse : interviewerResponse;
    if (target.querySelector('.placeholder-text')) target.innerHTML = '';
    aiStreamText += chunk;
    target.innerHTML = marked.parse(aiStreamText);
    target.scrollTop = target.scrollHeight;
  });

  electronAPI.onAIQuestion((question) => {
    aiQuestion.textContent = `识别到的问题: ${question}`;
    aiQuestion.classList.add('visible');
  });

  electronAPI.onAIStreamEnd((data) => {
    isAIProcessing = false;
    triggerAIBtn.disabled = false;
    aiResponse.classList.remove('loading');

    if (data.citations && data.citations.length > 0) renderCitations(data.citations);

    if (data.error) {
      const target = getCurrentMode() === 'candidate' ? aiResponse : interviewerResponse;
      target.innerHTML += `<br><span style="color:#e55">错误: ${data.error}</span>`;
    }

    const responseText = (getCurrentMode() === 'candidate' ? aiResponse : interviewerResponse).innerText;
    if (responseText && !responseText.includes('显示在这里')) {
      addToHistory(aiQuestion.textContent || getSelectedText().substring(0, 50), responseText);
    }
  });

  electronAPI.onRAGDebug((trace) => {
    ragDebugPanel.classList.remove('hidden');
    renderRAGDebug(trace);
  });

  ragDebugToggle.addEventListener('click', () => {
    ragDebugContent.classList.toggle('hidden');
    ragDebugToggle.querySelector('.debug-arrow').classList.toggle('open');
  });

  // --- PDF Agent stream ---
  electronAPI.onPDFAgentStream((type, data) => {
    if (type === 'progress') renderAgentSteps(data.step, data.message, data.done);
    if (type === 'analysis') renderAnalysis(data);
    if (type === 'knowledge-stream') renderKnowledgeStream(data);
    if (type === 'knowledge-done') {
      const item = document.getElementById(`knowledge-${data.index}`);
      if (item) item.classList.add('done');
    }
    if (type === 'complete') {
      pdfStatus.textContent = `分析完成: ${data.knowledgeCount} 个知识点已入库`;
      setTimeout(() => { pdfStatus.textContent = ''; }, 5000);
    }
    if (type === 'error') {
      agentContent.innerHTML += `<div style="color:#e55;padding:8px">错误: ${data.message}</div>`;
      pdfStatus.textContent = '';
    }
  });

  function renderCitations(citations) {
    aiCitations.innerHTML = '';
    for (const c of citations) {
      const div = document.createElement('div');
      div.className = 'citation-item';
      const badge = c.sourceType === 'pdf' ? '<span class="citation-badge pdf">PDF</span>' : '<span class="citation-badge web">WEB</span>';
      const name = c.filename || c.source || '';
      const page = c.pageRange ? ` - ${c.pageRange}` : '';
      const score = c.score ? `<span class="citation-score">${Math.round(c.score * 100)}%</span>` : '';
      div.innerHTML = `${badge} <span>${name}${page}</span> ${score}`;
      aiCitations.appendChild(div);
    }
  }

  const stepLabels = ['', '解析 PDF', '分析技术栈', '生成知识文档', '存储知识库'];

  function renderAgentSteps(currentStep, message, done) {
    agentSteps.innerHTML = '';
    for (let i = 1; i <= 4; i++) {
      const step = document.createElement('div');
      step.className = 'agent-step';
      if (i < currentStep || (i === currentStep && done)) step.classList.add('done');
      if (i === currentStep && !done) step.classList.add('active');
      step.innerHTML = `<span class="step-num">${i}</span><span class="step-label">${stepLabels[i]}</span>`;
      agentSteps.appendChild(step);
    }
    if (message) pdfStatus.textContent = message;
  }

  function renderAnalysis(data) {
    agentContent.innerHTML = '';
    if (data.summary) {
      const summary = document.createElement('div');
      summary.className = 'agent-summary';
      summary.textContent = data.summary;
      agentContent.appendChild(summary);
    }
    if (data.techStack && data.techStack.length > 0) {
      const tags = document.createElement('div');
      tags.className = 'tech-tags';
      for (const tech of data.techStack) {
        const tag = document.createElement('span');
        tag.className = 'tech-tag';
        tag.textContent = tech;
        tags.appendChild(tag);
      }
      agentContent.appendChild(tags);
    }
  }

  function renderKnowledgeStream(data) {
    if (!agentKnowledgeText[data.index]) {
      agentKnowledgeText[data.index] = '';
      const section = document.createElement('div');
      section.className = 'knowledge-item';
      section.id = `knowledge-${data.index}`;
      section.innerHTML = `<div class="knowledge-topic">${data.topic}</div><div class="knowledge-body"></div>`;
      agentContent.appendChild(section);
    }
    agentKnowledgeText[data.index] += data.chunk;
    const body = document.querySelector(`#knowledge-${data.index} .knowledge-body`);
    if (body) body.innerHTML = marked.parse(agentKnowledgeText[data.index]);
    agentContent.scrollTop = agentContent.scrollHeight;
  }

  function renderRAGDebug(trace) {
    let html = buildRAGMetricsSummaryHTML(trace);

    html += '<div class="debug-step"><div class="debug-step-label">问题提取</div>';
    if (trace.extractedQuestion) {
      html += `<div class="debug-step-value">${trace.extractedQuestion.question}<br><span style="color:#666">置信度: ${Math.round(trace.extractedQuestion.confidence * 100)}% · 方式: ${trace.extractedQuestion.method}</span></div>`;
    } else {
      html += '<div class="debug-step-value" style="color:#666">未提取到问题</div>';
    }
    html += '</div>';

    html += `<div class="debug-step"><div class="debug-step-label">搜索查询</div><div class="debug-step-value">${trace.searchQuery || '无'}</div></div>`;

    if (trace.pdfResults && trace.pdfResults.length > 0) {
      html += '<div class="debug-step"><div class="debug-step-label">知识库检索</div>';
      for (const r of trace.pdfResults) {
        const pct = Math.round((r.score || 0) * 100);
        html += `<div class="debug-result-item"><div class="debug-score-bar"><div class="debug-score-fill" style="width:${pct}%"></div></div><div class="debug-result-meta"><span>${r.filename || ''}</span>${r.position ? `<span class="kb-chunk-tag">${r.position}</span>` : ''}${r.domain ? `<span class="kb-chunk-tag group">${r.domain}</span>` : ''}<span style="color:#4a9eff">${pct}%</span>${r.page ? `<span>P${r.page}</span>` : ''}</div><div class="debug-result-content">${r.content || ''}</div></div>`;
      }
      html += '</div>';
    }

    if (trace.webResults && trace.webResults.length > 0) {
      html += '<div class="debug-step"><div class="debug-step-label">Web 检索</div>';
      for (const r of trace.webResults) {
        html += `<div class="debug-result-item"><div class="debug-result-meta"><span>${r.link || ''}</span></div><div class="debug-result-content">${r.content || ''}</div></div>`;
      }
      html += '</div>';
    }

    if (trace.rankedResults && trace.rankedResults.length > 0) {
      html += '<div class="debug-step"><div class="debug-step-label">最终排序</div>';
      for (const r of trace.rankedResults) {
        const badge = r.sourceType === 'pdf' ? '<span class="citation-badge pdf">PDF</span>' : '<span class="citation-badge web">WEB</span>';
        html += `<div class="debug-result-item"><div class="debug-result-meta">${badge} <span>${r.filename || ''}</span> <span style="color:#4a9eff">${Math.round((r.score || 0) * 100)}%</span></div><div class="debug-result-content">${r.contextSnippet || ''}</div></div>`;
      }
      html += '</div>';
    }

    if (trace.promptContext) {
      html += `<div class="debug-step"><div class="debug-step-label">Prompt 组装</div><div class="debug-step-value">上下文长度: ${trace.promptContext.contextLength} 字符 · 引用数: ${trace.promptContext.citationCount}</div></div>`;
    }

    if (trace.timings) {
      html += '<div class="debug-step"><div class="debug-step-label">耗时</div><div class="debug-timing">';
      if (trace.timings.questionExtraction !== undefined) html += `<div class="debug-timing-item"><span class="debug-timing-label">问题提取</span><span class="debug-timing-value">${trace.timings.questionExtraction}ms</span></div>`;
      if (trace.timings.pdfSearch !== undefined) html += `<div class="debug-timing-item"><span class="debug-timing-label">知识检索</span><span class="debug-timing-value">${trace.timings.pdfSearch}ms</span></div>`;
      if (trace.timings.webSearch !== undefined) html += `<div class="debug-timing-item"><span class="debug-timing-label">Web 搜索</span><span class="debug-timing-value">${trace.timings.webSearch}ms</span></div>`;
      if (trace.timings.total !== undefined) html += `<div class="debug-timing-item"><span class="debug-timing-label">总计</span><span class="debug-timing-value">${trace.timings.total}ms</span></div>`;
      html += '</div></div>';
    }

    ragDebugContent.innerHTML = html;
  }

  return { requestAICompletion };
}
