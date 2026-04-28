import './index.css'
import { marked } from 'marked'

marked.setOptions({ breaks: true, gfm: true })

// --- DOM 元素 ---
const recordBtn = document.getElementById('recordBtn')
const recordLabel = document.getElementById('recordLabel')
const recordIcon = document.getElementById('recordIcon')
const statusText = document.getElementById('statusText')
const transcriptArea = document.getElementById('transcriptArea')
const settingsBtn = document.getElementById('settingsBtn')
const settingsPanel = document.getElementById('settingsPanel')
const langSelect = document.getElementById('langSelect')
const audioDeviceSelect = document.getElementById('audioDeviceSelect')
const clearTranscriptBtn = document.getElementById('clearTranscriptBtn')

const modeCandidateBtn = document.getElementById('modeCandidateBtn')
const modeInterviewerBtn = document.getElementById('modeInterviewerBtn')
const candidatePanel = document.getElementById('candidatePanel')
const interviewerPanel = document.getElementById('interviewerPanel')

const aiQuestion = document.getElementById('aiQuestion')
const aiResponse = document.getElementById('aiResponse')
const aiCitations = document.getElementById('aiCitations')
const triggerAIBtn = document.getElementById('triggerAIBtn')

const uploadPDFBtn = document.getElementById('uploadPDFBtn')
const pdfList = document.getElementById('pdfList')
const pdfStatus = document.getElementById('pdfStatus')

const jdInput = document.getElementById('jdInput')
const recommendQuestionsBtn = document.getElementById('recommendQuestionsBtn')
const evaluateAnswerBtn = document.getElementById('evaluateAnswerBtn')
const interviewerResponse = document.getElementById('interviewerResponse')

const historyList = document.getElementById('historyList')
const clearHistoryBtn = document.getElementById('clearHistoryBtn')

// KB Management
const manageKBBtn = document.getElementById('manageKBBtn')
const kbFullpage = document.getElementById('kbFullpage')
const kbBackBtn = document.getElementById('kbBackBtn')
const kbGroupList = document.getElementById('kbGroupList')
const kbAddGroupBtn = document.getElementById('kbAddGroupBtn')
const kbFileList = document.getElementById('kbFileList')
const kbSearchInput = document.getElementById('kbSearchInput')
const kbChunkList = document.getElementById('kbChunkList')
const kbChunkCount = document.getElementById('kbChunkCount')
const kbAddChunkBtn = document.getElementById('kbAddChunkBtn')
const kbUploadBtn = document.getElementById('kbUploadBtn')
const kbViewList = document.getElementById('kbViewList')
const kbViewGrid = document.getElementById('kbViewGrid')
const kbDrawer = document.getElementById('kbDrawer')
const kbDrawerOverlay = document.getElementById('kbDrawerOverlay')
const kbEditorTitle = document.getElementById('kbEditorTitle')
const kbEditorClose = document.getElementById('kbEditorClose')
const kbEditorGroup = document.getElementById('kbEditorGroup')
const kbEditorFilename = document.getElementById('kbEditorFilename')
const kbEditorContent = document.getElementById('kbEditorContent')
const kbEditorCancel = document.getElementById('kbEditorCancel')
const kbEditorSave = document.getElementById('kbEditorSave')
const pdfSection = document.querySelector('.pdf-section')

// ASR 引擎设置
const asrEngineSelect = document.getElementById('asrEngineSelect')
const modelStatusItem = document.getElementById('modelStatusItem')
const modelStatusIcon = document.getElementById('modelStatusIcon')
const modelStatusText = document.getElementById('modelStatusText')
const downloadModelBtn = document.getElementById('downloadModelBtn')
const modelProgress = document.getElementById('modelProgress')
const modelProgressFill = document.getElementById('modelProgressFill')
const modelProgressText = document.getElementById('modelProgressText')

// RAG Debug
const ragDebugPanel = document.getElementById('ragDebugPanel')
const ragDebugToggle = document.getElementById('ragDebugToggle')
const ragDebugContent = document.getElementById('ragDebugContent')

let isRecording = false
let mediaStream = null
let systemAudioStream = null
let audioContext = null
let scriptProcessor = null
let currentMode = 'candidate'
let history = JSON.parse(localStorage.getItem('interview-history') || '[]')
let isAIProcessing = false
let aiStreamText = ''
let captureSystemAudio = localStorage.getItem('capture-system-audio') === 'true'

// --- 段落管理 ---
let segments = []
let currentSegmentId = null
let selectedSegmentId = null
let segmentIdCounter = 0
let consumedText = ''

// --- VAD 静音检测 ---
const SILENCE_THRESHOLD = 0.01
const SILENCE_DURATION_MS = 1500
let lastSpeechTime = 0
let silenceTimer = null
let hasSpokenInSegment = false

function getSelectedText() {
  if (selectedSegmentId !== null) {
    const seg = segments.find(s => s.id === selectedSegmentId)
    if (seg) return seg.text
  }
  if (segments.length > 0) return segments[segments.length - 1].text
  return ''
}

function finalizeCurrentSegment() {
  if (currentSegmentId === null) return
  const seg = segments.find(s => s.id === currentSegmentId)
  if (!seg || !seg.text.trim()) return

  seg.finalized = true
  consumedText += seg.text

  const newSeg = {
    id: segmentIdCounter++,
    text: '',
    timestamp: new Date().toLocaleTimeString(),
  }
  segments.push(newSeg)
  currentSegmentId = newSeg.id
  hasSpokenInSegment = false

  renderSegments()
}

function renderSegments() {
  if (segments.length === 0 && !currentSegmentId) {
    transcriptArea.innerHTML = '<div class="placeholder-text">点击下方按钮开始录音...</div>'
    return
  }

  transcriptArea.innerHTML = ''
  for (const seg of segments) {
    const div = document.createElement('div')
    div.className = 'segment'
    if (seg.id === selectedSegmentId) div.classList.add('selected')
    if (seg.id === currentSegmentId && !seg.finalized) div.classList.add('recording')

    const header = document.createElement('div')
    header.className = 'segment-header'

    const time = document.createElement('span')
    time.className = 'segment-time'
    time.textContent = seg.timestamp

    header.appendChild(time)

    if (seg.finalized && seg.text.trim()) {
      const aiBtn = document.createElement('button')
      aiBtn.className = 'segment-ai-btn'
      aiBtn.textContent = 'AI 回答'
      aiBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        selectedSegmentId = seg.id
        renderSegments()
        requestAICompletion(seg.text)
      })
      header.appendChild(aiBtn)
    }

    const text = document.createElement('span')
    text.className = 'segment-text'
    if (seg.text) {
      text.textContent = seg.text
    } else {
      text.innerHTML = '<span class="interim">识别中...</span>'
    }

    div.appendChild(header)
    div.appendChild(text)

    div.addEventListener('click', () => {
      if (seg.id === currentSegmentId && !seg.finalized) return
      selectedSegmentId = selectedSegmentId === seg.id ? null : seg.id
      renderSegments()
    })

    transcriptArea.appendChild(div)
  }
  transcriptArea.scrollTop = transcriptArea.scrollHeight
}

// --- 设置管理 ---
const systemAudioToggle = document.getElementById('systemAudioToggle')

function loadSettings() {
  const saved = localStorage.getItem('vtt-settings')
  if (saved) {
    const s = JSON.parse(saved)
    langSelect.value = s.lang || 'zh'
    if (s.asrEngine) asrEngineSelect.value = s.asrEngine
  }
  systemAudioToggle.checked = captureSystemAudio
  handleAsrEngineChange()
}

function saveSettings() {
  localStorage.setItem('vtt-settings', JSON.stringify({ lang: langSelect.value, asrEngine: asrEngineSelect.value }))
}

langSelect.addEventListener('change', saveSettings)

asrEngineSelect.addEventListener('change', () => {
  saveSettings()
  handleAsrEngineChange()
})

async function handleAsrEngineChange() {
  if (asrEngineSelect.value === 'local') {
    modelStatusItem.classList.remove('hidden')
    modelStatusIcon.textContent = '⏳'
    modelStatusText.textContent = '检测模型中...'
    downloadModelBtn.style.display = 'none'
    modelProgress.classList.add('hidden')
    try {
      const result = await window.electronAPI.checkLocalModel()
      if (result.available) {
        modelStatusIcon.textContent = '✅'
        modelStatusText.textContent = '模型已就绪'
        downloadModelBtn.style.display = 'none'
      } else {
        modelStatusIcon.textContent = '⚠️'
        modelStatusText.textContent = '模型未下载（约 230MB）'
        downloadModelBtn.style.display = ''
      }
    } catch (e) {
      modelStatusIcon.textContent = '❌'
      modelStatusText.textContent = '检测失败: ' + e.message
    }
  } else {
    modelStatusItem.classList.add('hidden')
  }
}

downloadModelBtn.addEventListener('click', async () => {
  downloadModelBtn.style.display = 'none'
  modelProgress.classList.remove('hidden')
  modelStatusIcon.textContent = '⬇️'
  modelStatusText.textContent = '下载中...'

  const result = await window.electronAPI.downloadLocalModel()
  if (result.success) {
    modelStatusIcon.textContent = '✅'
    modelStatusText.textContent = '模型已就绪'
    modelProgress.classList.add('hidden')
  } else {
    modelStatusIcon.textContent = '❌'
    modelStatusText.textContent = '下载失败: ' + result.error
    downloadModelBtn.style.display = ''
    modelProgress.classList.add('hidden')
  }
})

window.electronAPI.onModelDownloadProgress((progress) => {
  modelProgressFill.style.width = progress.percent + '%'
  modelProgressText.textContent = progress.message || (progress.percent + '%')
  if (progress.stage === 'extract') {
    modelStatusIcon.textContent = '📦'
    modelStatusText.textContent = '解压中...'
  }
})

systemAudioToggle.addEventListener('change', () => {
  captureSystemAudio = systemAudioToggle.checked
  localStorage.setItem('capture-system-audio', captureSystemAudio)
})

settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  settingsPanel.classList.toggle('hidden')
  if (!settingsPanel.classList.contains('hidden')) refreshDeviceList()
})

document.addEventListener('click', (e) => {
  if (!settingsPanel.contains(e.target) && e.target !== settingsBtn) {
    settingsPanel.classList.add('hidden')
  }
})

// --- 模式切换 ---
modeCandidateBtn.addEventListener('click', () => switchMode('candidate'))
modeInterviewerBtn.addEventListener('click', () => switchMode('interviewer'))

function switchMode(mode) {
  currentMode = mode
  modeCandidateBtn.classList.toggle('active', mode === 'candidate')
  modeInterviewerBtn.classList.toggle('active', mode === 'interviewer')
  candidatePanel.classList.toggle('hidden', mode !== 'candidate')
  interviewerPanel.classList.toggle('hidden', mode !== 'interviewer')
}

// --- 音频设备管理 ---
async function refreshDeviceList() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true })
    const devices = await navigator.mediaDevices.enumerateDevices()
    const audioInputs = devices.filter(d => d.kind === 'audioinput')
    audioDeviceSelect.innerHTML = ''
    for (const device of audioInputs) {
      const opt = document.createElement('option')
      opt.value = device.deviceId
      opt.textContent = device.label || `音频输入 ${audioDeviceSelect.options.length + 1}`
      audioDeviceSelect.appendChild(opt)
    }
  } catch (err) {
    console.error('枚举设备失败:', err)
  }
}

// --- 录音逻辑 ---
recordBtn.addEventListener('click', async () => {
  if (!isRecording) {
    await startRecording()
  } else {
    await stopRecording()
  }
})

async function startRecording() {
  try {
    const constraints = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }
    const deviceId = audioDeviceSelect.value
    if (deviceId) constraints.audio.deviceId = { exact: deviceId }

    mediaStream = await navigator.mediaDevices.getUserMedia(constraints)

    await startDoubaoStreaming()

    const newSeg = {
      id: segmentIdCounter++,
      text: '',
      timestamp: new Date().toLocaleTimeString(),
    }
    segments.push(newSeg)
    currentSegmentId = newSeg.id
    consumedText = ''
    lastSpeechTime = Date.now()
    hasSpokenInSegment = false

    isRecording = true
    recordBtn.classList.add('recording')
    recordLabel.textContent = '停止录音'
    statusText.textContent = '正在实时识别...'

    renderSegments()
  } catch (err) {
    statusText.textContent = `音频访问失败: ${err.message}`
  }
}

async function stopRecording() {
  await stopDoubaoStreaming()

  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }

  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop())
    mediaStream = null
  }

  if (systemAudioStream) {
    systemAudioStream.getTracks().forEach(t => t.stop())
    systemAudioStream = null
  }

  // 如果当前段落为空，移除它
  const idx = segments.findIndex(s => s.id === currentSegmentId)
  if (idx !== -1 && !segments[idx].text.trim()) {
    segments.splice(idx, 1)
  }

  currentSegmentId = null
  isRecording = false
  recordBtn.classList.remove('recording')
  recordLabel.textContent = '开始录音'
  statusText.textContent = ''

  renderSegments()
}

// --- 豆包流式识别 ---
async function startDoubaoStreaming() {
  const result = await window.electronAPI.startStream({ lang: langSelect.value, asrEngine: asrEngineSelect.value })
  if (!result.success) throw new Error(result.error)

  audioContext = new AudioContext({ sampleRate: 16000 })
  const micSource = audioContext.createMediaStreamSource(mediaStream)

  // 混合节点：麦克风 + 系统音频（如果开启）
  const merger = audioContext.createChannelMerger(1)
  micSource.connect(merger, 0, 0)

  if (captureSystemAudio) {
    try {
      await window.electronAPI.enableLoopbackAudio()
      systemAudioStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      // 移除不需要的视频轨道
      systemAudioStream.getVideoTracks().forEach(t => { t.stop(); systemAudioStream.removeTrack(t) })
      await window.electronAPI.disableLoopbackAudio()

      const sysSource = audioContext.createMediaStreamSource(systemAudioStream)
      sysSource.connect(merger, 0, 0)
      statusText.textContent = '正在实时识别（含系统音频）...'
    } catch (err) {
      console.warn('系统音频捕获失败，仅使用麦克风:', err.message)
      systemAudioStream = null
    }
  }

  scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1)

  scriptProcessor.onaudioprocess = (e) => {
    const float32 = e.inputBuffer.getChannelData(0)

    // VAD: 计算 RMS 音量
    let sum = 0
    for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i]
    const rms = Math.sqrt(sum / float32.length)

    if (rms > SILENCE_THRESHOLD) {
      lastSpeechTime = Date.now()
      hasSpokenInSegment = true
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
    } else if (hasSpokenInSegment && !silenceTimer) {
      silenceTimer = setTimeout(() => {
        silenceTimer = null
        finalizeCurrentSegment()
      }, SILENCE_DURATION_MS)
    }

    const int16 = new Int16Array(float32.length)
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]))
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }
    window.electronAPI.sendChunk(Array.from(int16), false)
  }

  merger.connect(scriptProcessor)
  scriptProcessor.connect(audioContext.destination)
}

async function stopDoubaoStreaming() {
  if (scriptProcessor) { scriptProcessor.disconnect(); scriptProcessor = null }
  if (audioContext) { audioContext.close(); audioContext = null }
  await window.electronAPI.stopStream()
}

// --- 流式识别结果 ---
window.electronAPI.onStreamResult((data) => {
  if (currentSegmentId === null) return

  let fullText = ''
  if (data.utterances && data.utterances.length > 0) {
    fullText = data.utterances.map(u => u.text).join('')
  } else if (data.text) {
    fullText = data.text
  }

  // 当前段落只显示消费偏移之后的增量文本
  const seg = segments.find(s => s.id === currentSegmentId)
  if (seg) {
    const newText = fullText.length > consumedText.length
      ? fullText.substring(consumedText.length)
      : fullText
    seg.text = newText
  }

  renderSegments()
})

window.electronAPI.onStreamError((msg) => {
  statusText.textContent = `错误: ${msg}`
})

// --- AI 回答 ---
triggerAIBtn.addEventListener('click', () => {
  const text = getSelectedText()
  if (!text.trim()) return
  requestAICompletion(text)
})

async function requestAICompletion(text) {
  if (isAIProcessing) return
  isAIProcessing = true
  triggerAIBtn.disabled = true

  aiResponse.innerHTML = ''
  aiResponse.classList.add('loading')
  aiQuestion.classList.remove('visible')
  aiCitations.innerHTML = ''
  aiStreamText = ''
  ragDebugPanel.classList.add('hidden')
  ragDebugContent.innerHTML = ''

  const mode = currentMode === 'candidate' ? 'copilot' : 'interviewer-evaluate'
  const background = currentMode === 'interviewer' ? jdInput.value : ''

  await window.electronAPI.aiCompletion(text, mode, background)
}

window.electronAPI.onAIStream((chunk) => {
  aiResponse.classList.remove('loading')
  const target = currentMode === 'candidate' ? aiResponse : interviewerResponse
  if (target.querySelector('.placeholder-text')) target.innerHTML = ''
  aiStreamText += chunk
  target.innerHTML = marked.parse(aiStreamText)
  target.scrollTop = target.scrollHeight
})

window.electronAPI.onAIQuestion((question) => {
  aiQuestion.textContent = `识别到的问题: ${question}`
  aiQuestion.classList.add('visible')
})

window.electronAPI.onAIStreamEnd((data) => {
  isAIProcessing = false
  triggerAIBtn.disabled = false
  aiResponse.classList.remove('loading')

  if (data.citations && data.citations.length > 0) {
    renderCitations(data.citations)
  }

  if (data.error) {
    const target = currentMode === 'candidate' ? aiResponse : interviewerResponse
    target.innerHTML += `<br><span style="color:#e55">错误: ${data.error}</span>`
  }

  const responseText = (currentMode === 'candidate' ? aiResponse : interviewerResponse).innerText
  if (responseText && !responseText.includes('显示在这里')) {
    const questionText = aiQuestion.textContent || getSelectedText().substring(0, 50)
    addToHistory(questionText, responseText)
  }
})

function renderCitations(citations) {
  aiCitations.innerHTML = ''
  for (const c of citations) {
    const div = document.createElement('div')
    div.className = 'citation-item'
    const badge = c.sourceType === 'pdf' ? '<span class="citation-badge pdf">PDF</span>' : '<span class="citation-badge web">WEB</span>'
    const name = c.filename || c.source || ''
    const page = c.pageRange ? ` - ${c.pageRange}` : ''
    const score = c.score ? `<span class="citation-score">${Math.round(c.score * 100)}%</span>` : ''
    div.innerHTML = `${badge} <span>${name}${page}</span> ${score}`
    aiCitations.appendChild(div)
  }
}

// --- 面试官模式 ---
recommendQuestionsBtn.addEventListener('click', async () => {
  if (isAIProcessing) return
  isAIProcessing = true
  interviewerResponse.innerHTML = ''
  interviewerResponse.classList.add('loading')
  aiStreamText = ''

  const resume = getSelectedText() || ''
  await window.electronAPI.aiCompletion(jdInput.value || '通用技术面试', 'interviewer-recommend', resume)
})

evaluateAnswerBtn.addEventListener('click', async () => {
  const text = getSelectedText()
  if (!text.trim()) return
  requestAICompletion(text)
})

// --- PDF 管理 + Agent 分析 ---
const agentPanel = document.getElementById('agentPanel')
const agentSteps = document.getElementById('agentSteps')
const agentContent = document.getElementById('agentContent')

let agentKnowledgeText = {}

uploadPDFBtn.addEventListener('click', async () => {
  agentPanel.classList.remove('hidden')
  agentSteps.innerHTML = ''
  agentContent.innerHTML = '<div class="placeholder-text">等待选择文件...</div>'
  agentKnowledgeText = {}

  const result = await window.electronAPI.uploadPDF()
  if (!result.success && !result.canceled) {
    agentContent.innerHTML = `<div style="color:#e55">错误: ${result.error || '上传失败'}</div>`
  }
})

const stepLabels = ['', '解析 PDF', '分析技术栈', '生成知识文档', '存储知识库']

function renderAgentSteps(currentStep, message, done) {
  agentSteps.innerHTML = ''
  for (let i = 1; i <= 4; i++) {
    const step = document.createElement('div')
    step.className = 'agent-step'
    if (i < currentStep || (i === currentStep && done)) step.classList.add('done')
    if (i === currentStep && !done) step.classList.add('active')
    step.innerHTML = `<span class="step-num">${i}</span><span class="step-label">${stepLabels[i]}</span>`
    agentSteps.appendChild(step)
  }
  if (message) {
    pdfStatus.textContent = message
  }
}

window.electronAPI.onPDFAgentStream((type, data) => {
  if (type === 'progress') {
    renderAgentSteps(data.step, data.message, data.done)
  }

  if (type === 'analysis') {
    agentContent.innerHTML = ''
    if (data.summary) {
      const summary = document.createElement('div')
      summary.className = 'agent-summary'
      summary.textContent = data.summary
      agentContent.appendChild(summary)
    }
    if (data.techStack && data.techStack.length > 0) {
      const tags = document.createElement('div')
      tags.className = 'tech-tags'
      for (const tech of data.techStack) {
        const tag = document.createElement('span')
        tag.className = 'tech-tag'
        tag.textContent = tech
        tags.appendChild(tag)
      }
      agentContent.appendChild(tags)
    }
  }

  if (type === 'knowledge-stream') {
    if (!agentKnowledgeText[data.index]) {
      agentKnowledgeText[data.index] = ''
      const section = document.createElement('div')
      section.className = 'knowledge-item'
      section.id = `knowledge-${data.index}`
      section.innerHTML = `<div class="knowledge-topic">${data.topic}</div><div class="knowledge-body"></div>`
      agentContent.appendChild(section)
    }
    agentKnowledgeText[data.index] += data.chunk
    const body = document.querySelector(`#knowledge-${data.index} .knowledge-body`)
    if (body) body.innerHTML = marked.parse(agentKnowledgeText[data.index])
    agentContent.scrollTop = agentContent.scrollHeight
  }

  if (type === 'knowledge-done') {
    // 知识点完成，可折叠
    const item = document.getElementById(`knowledge-${data.index}`)
    if (item) item.classList.add('done')
  }

  if (type === 'complete') {
    pdfStatus.textContent = `分析完成: ${data.knowledgeCount} 个知识点已入库`
    setTimeout(() => { pdfStatus.textContent = '' }, 5000)
    refreshPDFList()
  }

  if (type === 'error') {
    agentContent.innerHTML += `<div style="color:#e55;padding:8px">错误: ${data.message}</div>`
    pdfStatus.textContent = ''
  }
})

async function refreshPDFList() {
  const result = await window.electronAPI.listPDFs()
  if (!result.success) return

  if (result.pdfs.length === 0) {
    pdfList.innerHTML = '<div class="placeholder-text">上传简历或技术文档，AI 自动分析并生成面试知识库</div>'
    return
  }

  pdfList.innerHTML = ''
  for (const pdf of result.pdfs) {
    const div = document.createElement('div')
    div.className = 'pdf-item'
    div.innerHTML = `
      <span class="pdf-name">${pdf.filename}</span>
      <span class="pdf-chunks">${pdf.chunks} 条</span>
      <button class="small-btn danger" data-filename="${pdf.filename}">删除</button>
    `
    div.querySelector('button').addEventListener('click', async (e) => {
      const filename = e.target.dataset.filename
      await window.electronAPI.deletePDF(filename)
      refreshPDFList()
    })
    pdfList.appendChild(div)
  }
}

window.electronAPI.onPDFStatus((msg) => {
  pdfStatus.textContent = msg
  setTimeout(() => { pdfStatus.textContent = '' }, 3000)
})

// --- 历史记录 ---
function addToHistory(question, answer) {
  history.unshift({
    question: question.substring(0, 80),
    answer: answer.substring(0, 200),
    time: new Date().toLocaleTimeString(),
    mode: currentMode,
  })
  if (history.length > 20) history.pop()
  localStorage.setItem('interview-history', JSON.stringify(history))
  renderHistory()
}

function renderHistory() {
  if (history.length === 0) {
    historyList.innerHTML = ''
    return
  }
  historyList.innerHTML = ''
  for (const item of history) {
    const div = document.createElement('div')
    div.className = 'history-item'
    div.innerHTML = `
      <div class="history-question">${item.question}</div>
      <div class="history-meta">${item.time} · ${item.mode === 'candidate' ? '面试者' : '面试官'}</div>
    `
    div.addEventListener('click', () => {
      const target = currentMode === 'candidate' ? aiResponse : interviewerResponse
      target.innerHTML = item.answer.replace(/\n/g, '<br>')
    })
    historyList.appendChild(div)
  }
}

clearHistoryBtn.addEventListener('click', () => {
  history = []
  localStorage.removeItem('interview-history')
  renderHistory()
})

clearTranscriptBtn.addEventListener('click', () => {
  segments = []
  currentSegmentId = null
  selectedSegmentId = null
  renderSegments()
})

// --- 快捷键 ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!kbDrawer.classList.contains('hidden')) { closeKBDrawer(); return }
    if (!kbFullpage.classList.contains('hidden')) { kbFullpage.classList.add('hidden'); return }
  }
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault()
    const text = getSelectedText()
    if (text.trim()) requestAICompletion(text)
  }
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault()
    switchMode(currentMode === 'candidate' ? 'interviewer' : 'candidate')
  }
})

// --- 知识库管理（全屏页面） ---
let kbGroups = []
let kbActiveGroup = ''
let kbActiveFile = ''
let kbEditingChunkId = null
let kbViewMode = 'list'

manageKBBtn.addEventListener('click', () => {
  kbFullpage.classList.remove('hidden')
  loadKBData()
})

kbBackBtn.addEventListener('click', () => {
  kbFullpage.classList.add('hidden')
  closeKBDrawer()
})

kbUploadBtn.addEventListener('click', async () => {
  const result = await window.electronAPI.uploadPDF()
  if (result.success) {
    loadKBData()
    refreshPDFList()
  }
})

kbViewList.addEventListener('click', () => {
  kbViewMode = 'list'
  kbViewList.classList.add('active')
  kbViewGrid.classList.remove('active')
  kbChunkList.classList.remove('grid')
})

kbViewGrid.addEventListener('click', () => {
  kbViewMode = 'grid'
  kbViewGrid.classList.add('active')
  kbViewList.classList.remove('active')
  kbChunkList.classList.add('grid')
})

async function loadKBData() {
  await Promise.all([loadKBGroups(), loadKBFiles(), loadKBChunks()])
}

async function loadKBGroups() {
  const result = await window.electronAPI.listGroups()
  kbGroups = result.success ? result.groups : []
  renderKBSidebarGroups()
}

async function loadKBFiles() {
  const result = await window.electronAPI.listPDFs()
  if (!result.success) return
  kbFileList.innerHTML = ''
  for (const pdf of result.pdfs) {
    const div = document.createElement('div')
    div.className = `kb-file-item${kbActiveFile === pdf.filename ? ' active' : ''}`
    div.innerHTML = `
      <span class="kb-file-icon">📄</span>
      <span class="kb-file-name">${pdf.filename}</span>
      <span class="kb-file-badge">${pdf.chunks}</span>
    `
    div.addEventListener('click', () => {
      kbActiveFile = kbActiveFile === pdf.filename ? '' : pdf.filename
      loadKBFiles()
      loadKBChunks()
    })
    kbFileList.appendChild(div)
  }
}

function renderKBSidebarGroups() {
  kbGroupList.innerHTML = ''

  const allItem = document.createElement('div')
  allItem.className = `kb-group-item${kbActiveGroup === '' ? ' active' : ''}`
  allItem.innerHTML = `<span class="kb-group-icon">📁</span><span class="kb-group-name">全部</span>`
  allItem.addEventListener('click', () => { kbActiveGroup = ''; renderKBSidebarGroups(); loadKBChunks() })
  kbGroupList.appendChild(allItem)

  for (const g of kbGroups) {
    const item = document.createElement('div')
    item.className = `kb-group-item${kbActiveGroup === g.name ? ' active' : ''}`
    item.innerHTML = `<span class="kb-group-icon">📂</span><span class="kb-group-name">${g.name}</span>`
    item.addEventListener('click', () => { kbActiveGroup = g.name; renderKBSidebarGroups(); loadKBChunks() })
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (confirm(`删除分组「${g.name}」？（不会删除知识片段）`)) {
        kbGroups = kbGroups.filter(x => x.name !== g.name)
        window.electronAPI.saveGroups(kbGroups)
        if (kbActiveGroup === g.name) kbActiveGroup = ''
        renderKBSidebarGroups()
      }
    })
    kbGroupList.appendChild(item)
  }
}

kbAddGroupBtn.addEventListener('click', () => {
  const name = prompt('输入分组名称：')
  if (!name || !name.trim()) return
  if (kbGroups.some(g => g.name === name.trim())) return
  kbGroups.push({ name: name.trim() })
  window.electronAPI.saveGroups(kbGroups)
  renderKBSidebarGroups()
})

let kbSearchTimer = null
kbSearchInput.addEventListener('input', () => {
  clearTimeout(kbSearchTimer)
  kbSearchTimer = setTimeout(() => loadKBChunks(), 300)
})

async function loadKBChunks() {
  const filters = {}
  if (kbActiveGroup) filters.group = kbActiveGroup
  if (kbActiveFile) filters.filename = kbActiveFile
  const searchText = kbSearchInput.value.trim()
  if (searchText) filters.searchText = searchText

  const result = await window.electronAPI.listChunks(filters)
  if (!result.success) return

  const chunks = result.chunks
  kbChunkCount.textContent = `${chunks.length} 条知识片段`

  kbChunkList.innerHTML = ''
  if (chunks.length === 0) {
    kbChunkList.innerHTML = `
      <div class="kb-empty">
        <div class="kb-empty-icon">📚</div>
        <div class="kb-empty-text">还没有知识片段</div>
        <div class="kb-empty-hint">上传 PDF 或 Markdown 文档，或手动添加知识</div>
      </div>
    `
    return
  }

  for (const chunk of chunks) {
    const div = document.createElement('div')
    div.className = 'kb-chunk-item'

    const typeClass = chunk.sourceType || 'pdf'
    const typeLabel = typeClass === 'manual' ? '手动' : typeClass === 'markdown' ? 'MD' : 'PDF'
    const groupTag = chunk.group ? `<span class="kb-chunk-tag group">${chunk.group}</span>` : ''
    const time = chunk.updatedAt ? new Date(chunk.updatedAt).toLocaleDateString() : ''

    div.innerHTML = `
      <div class="kb-chunk-header">
        <span class="kb-chunk-filename">${chunk.filename || ''}</span>
        <span class="kb-chunk-tag ${typeClass}">${typeLabel}</span>
        ${groupTag}
      </div>
      <div class="kb-chunk-content">${chunk.content.substring(0, 300)}</div>
      <div class="kb-chunk-meta">
        <span class="kb-chunk-time">${time}</span>
        <div class="kb-chunk-actions">
          <button class="small-btn" data-action="edit">编辑</button>
          <button class="small-btn danger" data-action="delete">删除</button>
        </div>
      </div>
    `

    div.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
      e.stopPropagation()
      openKBDrawer(chunk)
    })
    div.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm('确认删除这条知识片段？')) return
      await window.electronAPI.deleteChunk(chunk.id)
      loadKBChunks()
    })

    kbChunkList.appendChild(div)
  }
}

function openKBDrawer(chunk) {
  kbEditingChunkId = chunk ? chunk.id : null
  kbEditorTitle.textContent = chunk ? '编辑知识片段' : '添加知识片段'
  kbEditorContent.value = chunk ? chunk.content : ''
  kbEditorFilename.value = chunk ? (chunk.filename || '') : '手动添加'
  kbEditorFilename.disabled = !!chunk

  kbEditorGroup.innerHTML = '<option value="">无分组</option>'
  for (const g of kbGroups) {
    const opt = document.createElement('option')
    opt.value = g.name
    opt.textContent = g.name
    kbEditorGroup.appendChild(opt)
  }
  kbEditorGroup.value = chunk ? (chunk.group || '') : kbActiveGroup

  kbDrawer.classList.remove('hidden')
  kbDrawerOverlay.classList.remove('hidden')
}

function closeKBDrawer() {
  kbDrawer.classList.add('hidden')
  kbDrawerOverlay.classList.add('hidden')
}

kbAddChunkBtn.addEventListener('click', () => openKBDrawer(null))
kbEditorClose.addEventListener('click', closeKBDrawer)
kbEditorCancel.addEventListener('click', closeKBDrawer)
kbDrawerOverlay.addEventListener('click', closeKBDrawer)

kbEditorSave.addEventListener('click', async () => {
  const content = kbEditorContent.value.trim()
  if (!content) return

  kbEditorSave.disabled = true
  kbEditorSave.textContent = '保存中...'

  try {
    if (kbEditingChunkId) {
      await window.electronAPI.updateChunk(kbEditingChunkId, {
        content,
        group: kbEditorGroup.value,
      })
    } else {
      await window.electronAPI.addChunk({
        content,
        group: kbEditorGroup.value,
        filename: kbEditorFilename.value || '手动添加',
        sourceType: 'manual',
      })
    }
    closeKBDrawer()
    loadKBChunks()
    refreshPDFList()
  } catch (err) {
    alert('保存失败: ' + err.message)
  } finally {
    kbEditorSave.disabled = false
    kbEditorSave.textContent = '保存'
  }
})

// --- RAG 调试面板 ---
ragDebugToggle.addEventListener('click', () => {
  ragDebugContent.classList.toggle('hidden')
  ragDebugToggle.querySelector('.debug-arrow').classList.toggle('open')
})

window.electronAPI.onRAGDebug((trace) => {
  ragDebugPanel.classList.remove('hidden')
  renderRAGDebug(trace)
})

function renderRAGDebug(trace) {
  let html = ''

  // 问题提取
  html += '<div class="debug-step">'
  html += '<div class="debug-step-label">问题提取</div>'
  if (trace.extractedQuestion) {
    html += `<div class="debug-step-value">${trace.extractedQuestion.question}<br><span style="color:#666">置信度: ${Math.round(trace.extractedQuestion.confidence * 100)}% · 方式: ${trace.extractedQuestion.method}</span></div>`
  } else {
    html += '<div class="debug-step-value" style="color:#666">未提取到问题</div>'
  }
  html += '</div>'

  // 搜索查询
  html += '<div class="debug-step">'
  html += '<div class="debug-step-label">搜索查询</div>'
  html += `<div class="debug-step-value">${trace.searchQuery || '无'}</div>`
  html += '</div>'

  // 知识检索结果
  if (trace.pdfResults && trace.pdfResults.length > 0) {
    html += '<div class="debug-step">'
    html += '<div class="debug-step-label">知识库检索</div>'
    for (const r of trace.pdfResults) {
      const pct = Math.round((r.score || 0) * 100)
      html += `<div class="debug-result-item">
        <div class="debug-score-bar"><div class="debug-score-fill" style="width:${pct}%"></div></div>
        <div class="debug-result-meta">
          <span>${r.filename || ''}</span>
          ${r.group ? `<span class="kb-chunk-tag">${r.group}</span>` : ''}
          <span style="color:#4a9eff">${pct}%</span>
          ${r.page ? `<span>P${r.page}</span>` : ''}
        </div>
        <div class="debug-result-content">${r.content || ''}</div>
      </div>`
    }
    html += '</div>'
  }

  // Web 检索结果
  if (trace.webResults && trace.webResults.length > 0) {
    html += '<div class="debug-step">'
    html += '<div class="debug-step-label">Web 检索</div>'
    for (const r of trace.webResults) {
      html += `<div class="debug-result-item">
        <div class="debug-result-meta"><span>${r.link || ''}</span></div>
        <div class="debug-result-content">${r.content || ''}</div>
      </div>`
    }
    html += '</div>'
  }

  // 排序结果
  if (trace.rankedResults && trace.rankedResults.length > 0) {
    html += '<div class="debug-step">'
    html += '<div class="debug-step-label">最终排序</div>'
    for (const r of trace.rankedResults) {
      const badge = r.sourceType === 'pdf' ? '<span class="citation-badge pdf">PDF</span>' : '<span class="citation-badge web">WEB</span>'
      html += `<div class="debug-result-item">
        <div class="debug-result-meta">${badge} <span>${r.filename || ''}</span> <span style="color:#4a9eff">${Math.round((r.score || 0) * 100)}%</span></div>
        <div class="debug-result-content">${r.contextSnippet || ''}</div>
      </div>`
    }
    html += '</div>'
  }

  // Prompt 上下文
  if (trace.promptContext) {
    html += '<div class="debug-step">'
    html += '<div class="debug-step-label">Prompt 组装</div>'
    html += `<div class="debug-step-value">上下文长度: ${trace.promptContext.contextLength} 字符 · 引用数: ${trace.promptContext.citationCount}</div>`
    html += '</div>'
  }

  // 耗时
  if (trace.timings) {
    html += '<div class="debug-step">'
    html += '<div class="debug-step-label">耗时</div>'
    html += '<div class="debug-timing">'
    if (trace.timings.questionExtraction !== undefined) html += `<div class="debug-timing-item"><span class="debug-timing-label">问题提取</span><span class="debug-timing-value">${trace.timings.questionExtraction}ms</span></div>`
    if (trace.timings.pdfSearch !== undefined) html += `<div class="debug-timing-item"><span class="debug-timing-label">知识检索</span><span class="debug-timing-value">${trace.timings.pdfSearch}ms</span></div>`
    if (trace.timings.webSearch !== undefined) html += `<div class="debug-timing-item"><span class="debug-timing-label">Web 搜索</span><span class="debug-timing-value">${trace.timings.webSearch}ms</span></div>`
    if (trace.timings.total !== undefined) html += `<div class="debug-timing-item"><span class="debug-timing-label">总计</span><span class="debug-timing-value">${trace.timings.total}ms</span></div>`
    html += '</div></div>'
  }

  ragDebugContent.innerHTML = html
}

// --- 初始化 ---
loadSettings()
renderHistory()
refreshPDFList()
renderSegments()
