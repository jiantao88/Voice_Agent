export function createSettings({ elements, electronAPI }) {
  const { settingsBtn, settingsPanel, langSelect, asrEngineSelect, audioDeviceSelect,
    modelStatusItem, modelStatusIcon, modelStatusText, downloadModelBtn, modelProgress,
    modelProgressFill, modelProgressText, systemAudioToggle,
    modeCandidateBtn, modeInterviewerBtn, candidatePanel, interviewerPanel,
    historyList, clearHistoryBtn, clearTranscriptBtn, positionSelect } = elements;

  let currentMode = 'candidate';
  let activePosition = localStorage.getItem('active-position') || '';
  let history = JSON.parse(localStorage.getItem('interview-history') || '[]');

  // --- Settings panel ---
  function loadSettings() {
    const saved = localStorage.getItem('vtt-settings');
    if (saved) {
      const s = JSON.parse(saved);
      langSelect.value = s.lang || 'zh';
      if (s.asrEngine) asrEngineSelect.value = s.asrEngine;
    }
    systemAudioToggle.checked = localStorage.getItem('capture-system-audio') === 'true';
    handleAsrEngineChange();
    loadPositionOptions();
  }

  function saveSettings() {
    localStorage.setItem('vtt-settings', JSON.stringify({ lang: langSelect.value, asrEngine: asrEngineSelect.value }));
  }

  langSelect.addEventListener('change', saveSettings);
  asrEngineSelect.addEventListener('change', () => { saveSettings(); handleAsrEngineChange(); });

  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPanel.classList.toggle('hidden');
    if (!settingsPanel.classList.contains('hidden')) refreshDeviceList();
  });

  document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target) && e.target !== settingsBtn) settingsPanel.classList.add('hidden');
  });

  async function handleAsrEngineChange() {
    if (asrEngineSelect.value === 'local') {
      modelStatusItem.classList.remove('hidden');
      modelStatusIcon.textContent = '⏳';
      modelStatusText.textContent = '检测模型中...';
      downloadModelBtn.style.display = 'none';
      modelProgress.classList.add('hidden');
      try {
        const result = await electronAPI.checkLocalModel();
        if (result.available) {
          modelStatusIcon.textContent = '✅';
          modelStatusText.textContent = '模型已就绪';
        } else {
          modelStatusIcon.textContent = '⚠️';
          modelStatusText.textContent = '模型未下载（约 230MB）';
          downloadModelBtn.style.display = '';
        }
      } catch (e) {
        modelStatusIcon.textContent = '❌';
        modelStatusText.textContent = '检测失败: ' + e.message;
      }
    } else {
      modelStatusItem.classList.add('hidden');
    }
  }

  downloadModelBtn.addEventListener('click', async () => {
    downloadModelBtn.style.display = 'none';
    modelProgress.classList.remove('hidden');
    modelStatusIcon.textContent = '⬇️';
    modelStatusText.textContent = '下载中...';
    const result = await electronAPI.downloadLocalModel();
    if (result.success) {
      modelStatusIcon.textContent = '✅';
      modelStatusText.textContent = '模型已就绪';
      modelProgress.classList.add('hidden');
    } else {
      modelStatusIcon.textContent = '❌';
      modelStatusText.textContent = '下载失败: ' + result.error;
      downloadModelBtn.style.display = '';
      modelProgress.classList.add('hidden');
    }
  });

  electronAPI.onModelDownloadProgress((progress) => {
    modelProgressFill.style.width = progress.percent + '%';
    modelProgressText.textContent = progress.message || (progress.percent + '%');
    if (progress.stage === 'extract') { modelStatusIcon.textContent = '📦'; modelStatusText.textContent = '解压中...'; }
  });

  async function refreshDeviceList() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      audioDeviceSelect.innerHTML = '';
      for (const device of audioInputs) {
        const opt = document.createElement('option');
        opt.value = device.deviceId;
        opt.textContent = device.label || `音频输入 ${audioDeviceSelect.options.length + 1}`;
        audioDeviceSelect.appendChild(opt);
      }
    } catch (err) {
      console.error('枚举设备失败:', err);
    }
  }

  // --- Position selector ---
  async function loadPositionOptions() {
    if (!positionSelect) return;
    const result = await electronAPI.listGroups();
    const groups = result.success ? result.groups : { positions: [] };
    positionSelect.innerHTML = '<option value="">全部岗位</option>';
    for (const pos of (groups.positions || [])) {
      const opt = document.createElement('option');
      opt.value = pos.id;
      opt.textContent = pos.name;
      positionSelect.appendChild(opt);
    }
    positionSelect.value = activePosition;
  }

  if (positionSelect) {
    positionSelect.addEventListener('change', () => {
      activePosition = positionSelect.value;
      localStorage.setItem('active-position', activePosition);
      electronAPI.setActivePosition(activePosition);
    });
  }

  // --- Mode switching ---
  modeCandidateBtn.addEventListener('click', () => switchMode('candidate'));
  modeInterviewerBtn.addEventListener('click', () => switchMode('interviewer'));

  function switchMode(mode) {
    currentMode = mode;
    modeCandidateBtn.classList.toggle('active', mode === 'candidate');
    modeInterviewerBtn.classList.toggle('active', mode === 'interviewer');
    candidatePanel.classList.toggle('hidden', mode !== 'candidate');
    interviewerPanel.classList.toggle('hidden', mode !== 'interviewer');
  }

  // --- History ---
  function addToHistory(question, answer) {
    history.unshift({
      question: question.substring(0, 80),
      answer: answer.substring(0, 200),
      time: new Date().toLocaleTimeString(),
      mode: currentMode,
    });
    if (history.length > 20) history.pop();
    localStorage.setItem('interview-history', JSON.stringify(history));
    renderHistory();
  }

  function renderHistory() {
    historyList.innerHTML = '';
    for (const item of history) {
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `<div class="history-question">${item.question}</div><div class="history-meta">${item.time} · ${item.mode === 'candidate' ? '面试者' : '面试官'}</div>`;
      div.addEventListener('click', () => {
        const target = currentMode === 'candidate' ? elements.aiResponse : elements.interviewerResponse;
        target.innerHTML = item.answer.replace(/\n/g, '<br>');
      });
      historyList.appendChild(div);
    }
  }

  clearHistoryBtn.addEventListener('click', () => {
    history = [];
    localStorage.removeItem('interview-history');
    renderHistory();
  });

  // --- PDF list ---
  async function refreshPDFList() {
    const result = await electronAPI.listPDFs();
    if (!result.success) return;
    const pdfList = elements.pdfList;
    if (result.pdfs.length === 0) {
      pdfList.innerHTML = '<div class="placeholder-text">上传简历或技术文档，AI 自动分析并生成面试知识库</div>';
      return;
    }
    pdfList.innerHTML = '';
    for (const pdf of result.pdfs) {
      const div = document.createElement('div');
      div.className = 'pdf-item';
      div.innerHTML = `<span class="pdf-name">${pdf.filename}</span><span class="pdf-chunks">${pdf.chunks} 条</span><button class="small-btn danger" data-filename="${pdf.filename}">删除</button>`;
      div.querySelector('button').addEventListener('click', async (e) => {
        await electronAPI.deletePDF(e.target.dataset.filename);
        refreshPDFList();
      });
      pdfList.appendChild(div);
    }
  }

  elements.uploadPDFBtn.addEventListener('click', async () => {
    elements.agentPanel.classList.remove('hidden');
    elements.agentSteps.innerHTML = '';
    elements.agentContent.innerHTML = '<div class="placeholder-text">等待选择文件...</div>';
    const result = await electronAPI.uploadPDF();
    if (!result.success && !result.canceled) {
      elements.agentContent.innerHTML = `<div style="color:#e55">错误: ${result.error || '上传失败'}</div>`;
    }
    refreshPDFList();
  });

  electronAPI.onPDFStatus((msg) => { elements.pdfStatus.textContent = msg; setTimeout(() => { elements.pdfStatus.textContent = ''; }, 3000); });

  return {
    loadSettings,
    getCurrentMode: () => currentMode,
    getActivePosition: () => activePosition,
    switchMode,
    addToHistory,
    renderHistory,
    refreshPDFList,
    loadPositionOptions,
  };
}
