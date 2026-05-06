const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 一次性识别（Whisper / 本地）
  sendAudio: (audioData, settings) => ipcRenderer.invoke('transcribe-audio', audioData, settings),

  // 豆包流式识别
  startStream: (settings) => ipcRenderer.invoke('start-doubao-stream', settings),
  sendChunk: (pcmData, isLast, sourceId) => ipcRenderer.invoke('send-audio-chunk', pcmData, isLast, sourceId),
  stopStream: (sourceId) => ipcRenderer.invoke('stop-doubao-stream', sourceId),
  onStreamResult: (callback) => ipcRenderer.on('stream-result', (_event, value) => callback(value)),
  onStreamError: (callback) => ipcRenderer.on('stream-error', (_event, value) => callback(value)),

  // 系统音频捕获
  enableLoopbackAudio: () => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopbackAudio: () => ipcRenderer.invoke('disable-loopback-audio'),

  // AI 面试助手
  aiCompletion: (text, mode, background, position) => ipcRenderer.invoke('ai-completion', { text, mode, background, position }),
  setActivePosition: (position) => ipcRenderer.invoke('set-active-position', { position }),
  onAIStream: (callback) => ipcRenderer.on('ai-stream', (_event, value) => callback(value)),
  onAIStreamEnd: (callback) => ipcRenderer.on('ai-stream-end', (_event, value) => callback(value)),
  onAIQuestion: (callback) => ipcRenderer.on('ai-question', (_event, value) => callback(value)),

  // 面试复盘 MVP
  startInterviewSession: (payload) => ipcRenderer.invoke('start-interview-session', payload),
  recordInterviewSegment: (segment) => ipcRenderer.invoke('record-interview-segment', segment),
  endInterviewSession: (options) => ipcRenderer.invoke('end-interview-session', options),
  listInterviewSessions: () => ipcRenderer.invoke('list-interview-sessions'),
  getInterviewSession: (id) => ipcRenderer.invoke('get-interview-session', id),

  // PDF 管理
  uploadPDF: () => ipcRenderer.invoke('upload-pdf'),
  deletePDF: (filename) => ipcRenderer.invoke('delete-pdf', filename),
  listPDFs: () => ipcRenderer.invoke('list-pdfs'),
  onPDFStatus: (callback) => ipcRenderer.on('pdf-status', (_event, value) => callback(value)),

  // 知识库管理
  listChunks: (filters) => ipcRenderer.invoke('list-chunks', filters),
  getChunk: (id) => ipcRenderer.invoke('get-chunk', id),
  updateChunk: (id, updates) => ipcRenderer.invoke('update-chunk', { id, updates }),
  deleteChunk: (id) => ipcRenderer.invoke('delete-chunk', id),
  addChunk: (data) => ipcRenderer.invoke('add-chunk', data),
  listGroups: () => ipcRenderer.invoke('list-groups'),
  saveGroups: (groups) => ipcRenderer.invoke('save-groups', groups),
  setDocumentGroup: (filename, position, domain) => ipcRenderer.invoke('set-document-group', { filename, position, domain }),
  reclassifyChunks: () => ipcRenderer.invoke('reclassify-chunks'),
  onRAGDebug: (callback) => ipcRenderer.on('rag-debug', (_event, value) => callback(value)),

  // PDF 分析 Agent
  onPDFAgentProgress: (callback) => ipcRenderer.on('pdf-agent-progress', (_event, value) => callback(value)),
  onPDFAgentStream: (callback) => ipcRenderer.on('pdf-agent-stream', (_event, type, value) => callback(type, value)),

  // 本地 ASR 模型管理
  checkLocalModel: () => ipcRenderer.invoke('check-local-model'),
  downloadLocalModel: () => ipcRenderer.invoke('download-local-model'),
  onModelDownloadProgress: (callback) => ipcRenderer.on('model-download-progress', (_event, value) => callback(value)),

  // 通用
  onError: (callback) => ipcRenderer.on('transcription-error', (_event, value) => callback(value)),
})
