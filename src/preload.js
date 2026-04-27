const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 一次性识别（Whisper / 本地）
  sendAudio: (audioData, settings) => ipcRenderer.invoke('transcribe-audio', audioData, settings),

  // 豆包流式识别
  startStream: (settings) => ipcRenderer.invoke('start-doubao-stream', settings),
  sendChunk: (pcmData, isLast) => ipcRenderer.invoke('send-audio-chunk', pcmData, isLast),
  stopStream: () => ipcRenderer.invoke('stop-doubao-stream'),
  onStreamResult: (callback) => ipcRenderer.on('stream-result', (_event, value) => callback(value)),
  onStreamError: (callback) => ipcRenderer.on('stream-error', (_event, value) => callback(value)),

  // 系统音频捕获
  enableLoopbackAudio: () => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopbackAudio: () => ipcRenderer.invoke('disable-loopback-audio'),

  // AI 面试助手
  aiCompletion: (text, mode, background) => ipcRenderer.invoke('ai-completion', { text, mode, background }),
  onAIStream: (callback) => ipcRenderer.on('ai-stream', (_event, value) => callback(value)),
  onAIStreamEnd: (callback) => ipcRenderer.on('ai-stream-end', (_event, value) => callback(value)),
  onAIQuestion: (callback) => ipcRenderer.on('ai-question', (_event, value) => callback(value)),

  // PDF 管理
  uploadPDF: () => ipcRenderer.invoke('upload-pdf'),
  deletePDF: (filename) => ipcRenderer.invoke('delete-pdf', filename),
  listPDFs: () => ipcRenderer.invoke('list-pdfs'),
  onPDFStatus: (callback) => ipcRenderer.on('pdf-status', (_event, value) => callback(value)),

  // PDF 分析 Agent
  onPDFAgentProgress: (callback) => ipcRenderer.on('pdf-agent-progress', (_event, value) => callback(value)),
  onPDFAgentStream: (callback) => ipcRenderer.on('pdf-agent-stream', (_event, type, value) => callback(type, value)),

  // 通用
  onError: (callback) => ipcRenderer.on('transcription-error', (_event, value) => callback(value)),
})
