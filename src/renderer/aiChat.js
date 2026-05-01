import { marked } from 'marked';

export function createAIChat({ elements, electronAPI, getSelectedText, getCurrentMode, addToHistory }) {
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
    await electronAPI.aiCompletion(text, mode, background);
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
    let html = '';

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
        html += `<div class="debug-result-item"><div class="debug-score-bar"><div class="debug-score-fill" style="width:${pct}%"></div></div><div class="debug-result-meta"><span>${r.filename || ''}</span>${r.group ? `<span class="kb-chunk-tag">${r.group}</span>` : ''}<span style="color:#4a9eff">${pct}%</span>${r.page ? `<span>P${r.page}</span>` : ''}</div><div class="debug-result-content">${r.content || ''}</div></div>`;
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
