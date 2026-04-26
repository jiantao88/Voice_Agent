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

let isRecording = false
let mediaStream = null
let audioContext = null
let scriptProcessor = null
let currentMode = 'candidate'
let history = JSON.parse(localStorage.getItem('interview-history') || '[]')
let isAIProcessing = false
let aiStreamText = ''

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
function loadSettings() {
  const saved = localStorage.getItem('vtt-settings')
  if (saved) {
    const s = JSON.parse(saved)
    langSelect.value = s.lang || 'zh'
  }
}

function saveSettings() {
  localStorage.setItem('vtt-settings', JSON.stringify({ lang: langSelect.value }))
}

langSelect.addEventListener('change', saveSettings)

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
  const result = await window.electronAPI.startStream({ lang: langSelect.value })
  if (!result.success) throw new Error(result.error)

  audioContext = new AudioContext({ sampleRate: 16000 })
  const source = audioContext.createMediaStreamSource(mediaStream)
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

  source.connect(scriptProcessor)
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

// --- 初始化 ---
loadSettings()
renderHistory()
refreshPDFList()
renderSegments()
