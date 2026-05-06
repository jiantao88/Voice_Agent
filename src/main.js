import { app, BrowserWindow, ipcMain, session, desktopCapturer, dialog, systemPreferences } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { config as dotenvConfig } from 'dotenv';
import started from 'electron-squirrel-startup';

dotenvConfig({ path: path.join(app.getAppPath(), '.env') });

const loopbackFeatures = [
  'MacLoopbackAudioForScreenShare',
  'MacSckSystemAudioLoopbackOverride',
  'MacCatapSystemAudioLoopbackCapture',
  'PulseaudioLoopbackForScreenShare',
];
const existing = app.commandLine.getSwitchValue('enable-features');
if (app.commandLine.hasSwitch('enable-features')) {
  app.commandLine.removeSwitch('enable-features');
}
const allFeatures = [existing, ...loopbackFeatures].filter(Boolean).join(',');
app.commandLine.appendSwitch('enable-features', allFeatures);

if (started) {
  app.quit();
}

let mainWindow = null;

function send(channel, ...args) {
  mainWindow?.webContents.send(channel, ...args);
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 750,
    minWidth: 600,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f0f',
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

// ============================================================
// Imports
// ============================================================

import { startASR, feedAudio, stopASR } from './lib/asrEngine.js';
import { checkModel, downloadModel } from './lib/modelDownloader.js';
import { interviewEngine } from './lib/interviewEngine.js';
import { pineconeService } from './lib/pineconeService.js';
import { resumeAnalyzer } from './lib/resumeAnalyzer.js';
import { registerIPC } from './lib/ipcRouter.js';
import { interviewSessionStore } from './lib/interviewSessionStore.js';
import { buildInterviewReview } from './lib/interviewReviewAnalyzer.js';
import { persistReviewKnowledge } from './lib/reviewKnowledgeService.js';

// ============================================================
// IPC Routes (declarative)
// ============================================================

const routes = {
  // --- 系统音频捕获 ---
  'enable-loopback-audio': async () => {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    const screenStatus = systemPreferences.getMediaAccessStatus('screen');
    console.log(`[Loopback] Permission: mic=${micStatus}, screen=${screenStatus}`);
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      if (sources.length === 0) throw new Error('No screen sources found');
      console.log(`[Loopback] Using source: ${sources[0].name}, id: ${sources[0].id}`);
      callback({ video: sources[0], audio: 'loopback' });
    });
  },

  'disable-loopback-audio': async () => {
    session.defaultSession.setDisplayMediaRequestHandler(null);
  },

  // --- ASR ---
  'start-doubao-stream': async (_ctx, settings) => {
    const sourceId = settings.sourceId || 'default';
    await startASR(
      settings,
      (result) => send('stream-result', { ...result, sourceId }),
      (msg) => send('stream-error', { message: msg, sourceId }),
      sourceId,
    );
    return { success: true };
  },

  'send-audio-chunk': async (_ctx, pcmData, isLast, sourceId) => {
    feedAudio(pcmData, isLast, sourceId || 'default');
    return { success: true };
  },

  'stop-doubao-stream': async (_ctx, sourceId) => {
    stopASR(sourceId || 'default');
    return { success: true };
  },

  'check-local-model': async () => checkModel(),

  'download-local-model': async () => {
    const result = await downloadModel((progress) => send('model-download-progress', progress));
    return { success: true, ...result };
  },

  // --- 一次性识别（保留） ---
  'transcribe-audio': async (_ctx, audioArray, settings) => {
    const audioBuffer = Buffer.from(audioArray);
    const { mode, apiKey, lang } = settings;

    if (mode === 'cloud') {
      return { success: true, text: await transcribeWithWhisper(audioBuffer, apiKey, lang) };
    } else if (mode === 'local') {
      return { success: true, text: await transcribeWithLocal(audioBuffer, lang) };
    }
    throw new Error('未知识别模式');
  },

  // --- AI 面试 ---
  'ai-completion': async (_ctx, { text, mode, background, position }) => {
    await interviewEngine.process(text, mode, background, send, { position });
    return { success: true };
  },

  'set-active-position': async (_ctx, { position }) => {
    interviewEngine.setActivePosition(position);
    return { success: true };
  },

  // --- 面试复盘 MVP ---
  'start-interview-session': async (_ctx, payload = {}) => {
    const session = interviewSessionStore.startSession(payload);
    return { success: true, session };
  },

  'record-interview-segment': async (_ctx, segment) => {
    const session = interviewSessionStore.recordSegment(segment);
    return { success: true, recorded: Boolean(session) };
  },

  'end-interview-session': async (_ctx, options = {}) => {
    const active = interviewSessionStore.getActiveSession();
    if (!active) return { success: false, error: 'No active interview session' };
    const review = buildInterviewReview(active);
    if (Number(review.summary?.totalQuestions || 0) === 0) {
      interviewSessionStore.discardSession(active.id);
      return {
        success: true,
        discarded: true,
        review,
        knowledgeCount: 0,
        message: '未生成复盘：没有识别到面试官问题',
      };
    }
    const knowledgeCount = options.addToKnowledgeBase === false
      ? 0
      : await persistReviewKnowledge({ review, session: active, pineconeService });
    const session = interviewSessionStore.endSession(active.id, { review, knowledgeCount });
    return { success: true, session, review, knowledgeCount };
  },

  'list-interview-sessions': async () => ({ success: true, sessions: interviewSessionStore.listSessions() }),

  'get-interview-session': async (_ctx, id) => {
    const session = interviewSessionStore.getSession(id);
    if (!session) throw new Error('Interview session not found');
    return { success: true, session };
  },

  // --- PDF 上传 ---
  'upload-pdf': async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '文档', extensions: ['pdf', 'md'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Markdown', extensions: ['md'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };

    const filePath = result.filePaths[0];
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.md') {
      const mdText = fs.readFileSync(filePath, 'utf-8');
      const mdResult = await pineconeService.uploadMarkdown(mdText, filename);
      if (!mdResult) throw new Error('Markdown upload failed');
      return { success: true, filename, title: mdResult.title, chunks: mdResult.chunks };
    }

    const buffer = fs.readFileSync(filePath);
    const agentSend = (type, data) => send('pdf-agent-stream', type, data);
    return await resumeAnalyzer.process(buffer, filename, agentSend);
  },

  'delete-pdf': async (_ctx, filename) => {
    const { ragOrchestrator } = await import('./lib/ragOrchestrator.js');
    const success = await ragOrchestrator.deletePDF(filename);
    return { success };
  },

  'list-pdfs': async () => ({ success: true, pdfs: pineconeService.getUploadedFiles() }),

  // --- 知识库 CRUD ---
  'list-chunks': async (_ctx, filters) => ({ success: true, chunks: pineconeService.getChunks(filters || {}) }),
  'get-chunk': async (_ctx, id) => {
    const chunk = pineconeService.getChunkById(id);
    if (!chunk) throw new Error('Not found');
    return { success: true, chunk };
  },
  'update-chunk': async (_ctx, { id, updates }) => {
    const chunk = await pineconeService.updateChunk(id, updates);
    if (!chunk) throw new Error('Not found');
    return { success: true, chunk };
  },
  'delete-chunk': async (_ctx, id) => ({ success: true, deleted: pineconeService.deleteChunk(id) }),
  'add-chunk': async (_ctx, data) => ({ success: true, chunk: await pineconeService.addChunk(data) }),

  // --- 分组 ---
  'list-groups': async () => ({ success: true, groups: pineconeService.getGroups() }),
  'save-groups': async (_ctx, groups) => { pineconeService.saveGroups(groups); return { success: true }; },
  'set-document-group': async (_ctx, { filename, position, domain }) => ({ success: true, count: pineconeService.setDocumentGroup(filename, position, domain) }),
  'reclassify-chunks': async () => ({ success: true, count: pineconeService.reclassifyUnassigned() }),
};

// ============================================================
// Legacy functions (kept for transcribe-audio backward compat)
// ============================================================

async function transcribeWithWhisper(audioBuffer, apiKey, lang) {
  if (!apiKey) throw new Error('请在设置中填写 OpenAI API Key');

  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'audio.webm');
  formData.append('model', 'whisper-1');
  if (lang && lang !== 'auto') formData.append('language', lang);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Whisper API 错误 (${response.status}): ${err}`);
  }

  return (await response.json()).text;
}

async function transcribeWithLocal(audioBuffer, lang) {
  let nodewhisper;
  try {
    nodewhisper = (await import('nodejs-whisper')).nodewhisper;
  } catch {
    throw new Error('本地模型未安装，请运行: npm install nodejs-whisper');
  }

  const tempPath = path.join(os.tmpdir(), `vtt-recording-${Date.now()}.wav`);
  fs.writeFileSync(tempPath, audioBuffer);

  try {
    const result = await nodewhisper(tempPath, {
      modelName: 'base',
      autoDownloadModelName: 'base',
      removeWavFileAfterTranscription: true,
      whisperOptions: {
        language: lang === 'auto' ? undefined : lang,
        word_timestamps: true,
      },
    });
    return result.map(r => r.speech).join('').trim();
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

// ============================================================
// App lifecycle
// ============================================================

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      if (permission === 'media' || permission === 'display-capture') {
        callback(true);
      } else {
        callback(false);
      }
    }
  );

  createWindow();
  pineconeService.load();
  registerIPC(routes);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
