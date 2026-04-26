import './index.css'

// --- DOM 元素 ---
const recordBtn = document.getElementById('recordBtn')
const recordLabel = document.getElementById('recordLabel')
const statusText = document.getElementById('statusText')
const resultText = document.getElementById('resultText')
const copyBtn = document.getElementById('copyBtn')
const clearBtn = document.getElementById('clearBtn')
const settingsBtn = document.getElementById('settingsBtn')
const settingsPanel = document.getElementById('settingsPanel')
const modeSelect = document.getElementById('modeSelect')
const apiKeyGroup = document.getElementById('apiKeyGroup')
const apiKeyInput = document.getElementById('apiKeyInput')
const langSelect = document.getElementById('langSelect')
const audioSourceSelect = document.getElementById('audioSourceSelect')
const audioDeviceSelect = document.getElementById('audioDeviceSelect')

let isRecording = false
let mediaStream = null
let audioContext = null
let scriptProcessor = null

// --- 设置管理 ---
function loadSettings() {
  const saved = localStorage.getItem('vtt-settings')
  if (saved) {
    const s = JSON.parse(saved)
    modeSelect.value = s.mode || 'doubao'
    apiKeyInput.value = s.apiKey || ''
    langSelect.value = s.lang || 'zh'
    audioSourceSelect.value = s.audioSource || 'mic'
  }
  toggleSettingsVisibility()
}

function saveSettings() {
  localStorage.setItem('vtt-settings', JSON.stringify({
    mode: modeSelect.value,
    apiKey: apiKeyInput.value,
    lang: langSelect.value,
    audioSource: audioSourceSelect.value,
  }))
}

function getSettings() {
  return {
    mode: modeSelect.value,
    apiKey: apiKeyInput.value,
    lang: langSelect.value,
    audioSource: audioSourceSelect.value,
    deviceId: audioDeviceSelect.value,
  }
}

function toggleSettingsVisibility() {
  apiKeyGroup.style.display = modeSelect.value === 'cloud' ? 'block' : 'none'
}

modeSelect.addEventListener('change', () => { toggleSettingsVisibility(); saveSettings() })
apiKeyInput.addEventListener('input', saveSettings)
langSelect.addEventListener('change', saveSettings)
audioSourceSelect.addEventListener('change', () => { saveSettings(); refreshDeviceList() })

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
  const settings = getSettings()

  try {
    const constraints = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }
    if (settings.deviceId && settings.deviceId !== '') {
      constraints.audio.deviceId = { exact: settings.deviceId }
    }

    mediaStream = await navigator.mediaDevices.getUserMedia(constraints)

    if (settings.mode === 'doubao') {
      await startDoubaoStreaming(settings)
    } else {
      await startBatchRecording(settings)
    }

    isRecording = true
    recordBtn.classList.add('recording')
    recordLabel.textContent = '停止录音'
    statusText.textContent = settings.mode === 'doubao' ? '正在实时识别...' : '正在录音...'
  } catch (err) {
    statusText.textContent = `音频访问失败: ${err.message}`
  }
}

async function stopRecording() {
  const settings = getSettings()

  if (settings.mode === 'doubao') {
    await stopDoubaoStreaming()
  } else {
    stopBatchRecording()
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop())
    mediaStream = null
  }

  isRecording = false
  recordBtn.classList.remove('recording')
  recordLabel.textContent = '开始录音'
  statusText.textContent = '点击按钮开始录音'
}

// ============================================================
// 豆包流式模式：实时提取 PCM 并发送
// ============================================================

async function startDoubaoStreaming(settings) {
  const result = await window.electronAPI.startStream(settings)
  if (!result.success) {
    throw new Error(result.error)
  }

  resultText.textContent = ''
  resultText.classList.remove('placeholder')

  audioContext = new AudioContext({ sampleRate: 16000 })
  const source = audioContext.createMediaStreamSource(mediaStream)

  // ScriptProcessorNode: 4096 采样 = ~256ms @16kHz (buffer size 必须是 2 的幂)
  scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1)

  scriptProcessor.onaudioprocess = (e) => {
    const float32 = e.inputBuffer.getChannelData(0)
    // Float32 -> Int16 PCM
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
  if (scriptProcessor) {
    scriptProcessor.disconnect()
    scriptProcessor = null
  }
  if (audioContext) {
    audioContext.close()
    audioContext = null
  }
  await window.electronAPI.stopStream()
  statusText.textContent = '识别完成'
}

// 监听流式结果
window.electronAPI.onStreamResult((data) => {
  if (data.utterances && data.utterances.length > 0) {
    let html = ''
    for (const u of data.utterances) {
      if (u.definite) {
        html += `<span class="definite">${u.text}</span>`
      } else {
        html += `<span class="interim">${u.text}</span>`
      }
    }
    resultText.innerHTML = html
  } else if (data.text) {
    resultText.textContent = data.text
  }
  resultText.scrollTop = resultText.scrollHeight
})

window.electronAPI.onStreamError((msg) => {
  resultText.textContent = `错误: ${msg}`
  resultText.classList.remove('placeholder')
})

// ============================================================
// 一次性识别模式（Whisper / 本地）保留
// ============================================================

let batchRecorder = null
let batchChunks = []

async function startBatchRecording(settings) {
  batchRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm;codecs=opus' })
  batchChunks = []
  batchRecorder.ondataavailable = (e) => batchChunks.push(e.data)

  batchRecorder.onstop = async () => {
    statusText.textContent = '正在识别...'
    recordBtn.disabled = true

    const blob = new Blob(batchChunks, { type: 'audio/webm' })
    const arrayBuffer = await blob.arrayBuffer()

    try {
      const result = await window.electronAPI.sendAudio(
        Array.from(new Uint8Array(arrayBuffer)),
        settings
      )
      if (result.success) {
        resultText.textContent = result.text
        resultText.classList.remove('placeholder')
      } else {
        resultText.textContent = `识别失败: ${result.error}`
        resultText.classList.remove('placeholder')
      }
    } catch (err) {
      resultText.textContent = `识别失败: ${err.message || err}`
      resultText.classList.remove('placeholder')
    }

    statusText.textContent = '点击按钮开始录音'
    recordBtn.disabled = false
  }

  batchRecorder.start()
}

function stopBatchRecording() {
  if (batchRecorder && batchRecorder.state !== 'inactive') {
    batchRecorder.stop()
  }
  batchRecorder = null
}

// --- 复制 & 清空 ---
copyBtn.addEventListener('click', async () => {
  const text = resultText.innerText
  if (text && !resultText.classList.contains('placeholder')) {
    await navigator.clipboard.writeText(text)
    copyBtn.textContent = '已复制!'
    setTimeout(() => { copyBtn.textContent = '复制文字' }, 1500)
  }
})

clearBtn.addEventListener('click', () => {
  resultText.innerHTML = '识别结果将显示在这里...'
  resultText.classList.add('placeholder')
})

window.electronAPI.onError((msg) => {
  resultText.textContent = `错误: ${msg}`
  resultText.classList.remove('placeholder')
})

// 初始化
loadSettings()
resultText.classList.add('placeholder')
