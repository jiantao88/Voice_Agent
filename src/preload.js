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

  // 通用
  onError: (callback) => ipcRenderer.on('transcription-error', (_event, value) => callback(value)),
})
