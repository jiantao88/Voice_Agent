import { app, BrowserWindow, ipcMain, session, desktopCapturer } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { config as dotenvConfig } from 'dotenv';
import started from 'electron-squirrel-startup';

dotenvConfig({ path: path.join(app.getAppPath(), '.env') });

// 系统音频捕获：设置 Chromium feature flags（必须在 app.ready 之前）
const loopbackFeatures = [
  'MacLoopbackAudioForScreenShare',
  'MacSckSystemAudioLoopbackOverride',
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

// ============================================================
// ASR 引擎（豆包云端 + sherpa-onnx 本地）
// ============================================================
import { startASR, feedAudio, stopASR } from './lib/asrEngine.js';
import { checkModel, downloadModel } from './lib/modelDownloader.js';

// ============================================================
// IPC Handlers
// ============================================================

// 系统音频捕获（ScreenCaptureKit loopback）
ipcMain.handle('enable-loopback-audio', () => {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    if (sources.length === 0) throw new Error('No screen sources found');
    callback({ video: sources[0], audio: 'loopback' });
  });
});

ipcMain.handle('disable-loopback-audio', () => {
  session.defaultSession.setDisplayMediaRequestHandler(null);
});

ipcMain.handle('start-doubao-stream', async (_event, settings) => {
  try {
    const onResult = (result) => mainWindow?.webContents.send('stream-result', result);
    const onError = (msg) => mainWindow?.webContents.send('stream-error', msg);
    await startASR(settings, onResult, onError);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('send-audio-chunk', async (_event, pcmData, isLast) => {
  try {
    feedAudio(pcmData, isLast);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-doubao-stream', async () => {
  try {
    stopASR();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('check-local-model', () => {
  return checkModel();
});

ipcMain.handle('download-local-model', async () => {
  try {
    const result = await downloadModel((progress) => {
      mainWindow?.webContents.send('model-download-progress', progress);
    });
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 旧的一次性识别保留
ipcMain.handle('transcribe-audio', async (event, audioArray, settings) => {
  try {
    const audioBuffer = Buffer.from(audioArray);
    const { mode, apiKey, lang } = settings;

    if (mode === 'cloud') {
      return { success: true, text: await transcribeWithWhisper(audioBuffer, apiKey, lang) };
    } else if (mode === 'local') {
      return { success: true, text: await transcribeWithLocal(audioBuffer, lang) };
    }
    return { success: false, error: '未知识别模式' };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

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
// AI 面试助手 - Gemini + RAG
// ============================================================

import { streamChat, queryChat } from './lib/gemini.js';
import { ragOrchestrator } from './lib/ragOrchestrator.js';
import { pineconeService } from './lib/pineconeService.js';
import { resumeAnalyzer } from './lib/resumeAnalyzer.js';
import {
  buildPrompt, buildKnowledgeCheckPrompt, buildRAGPrompt,
  buildSummarizerPrompt, buildInterviewerPrompt, buildQuestionRecommendPrompt,
} from './lib/prompts.js';
import { dialog } from 'electron';

let uploadedPDFs = []; // kept for backward compat but also synced from local store

async function streamToRenderer(messages) {
  const useModel = process.env.MAIN_MODEL || 'vtrix-gemini-3-flash-preview';
  console.log('[AI] streamChat model:', useModel, 'baseURL:', process.env.LLM_BASE_URL);
  const stream = await streamChat(messages, useModel);
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) mainWindow?.webContents.send('ai-stream', content);
  }
}

ipcMain.handle('ai-completion', async (_event, { text, mode, background }) => {
  try {
    if (mode === 'summarizer') {
      await streamToRenderer([{ role: 'user', content: buildSummarizerPrompt(text) }]);
      mainWindow?.webContents.send('ai-stream-end', { citations: [] });
      return { success: true };
    }

    if (mode === 'interviewer-evaluate') {
      await streamToRenderer([
        { role: 'system', content: '你是一位资深技术面试官，请用中文回答。' },
        { role: 'user', content: buildInterviewerPrompt(background, '', text) },
      ]);
      mainWindow?.webContents.send('ai-stream-end', { citations: [] });
      return { success: true };
    }

    if (mode === 'interviewer-recommend') {
      const responseText = await queryChat([
        { role: 'system', content: '你是一位资深技术面试官，请用中文回答。' },
        { role: 'user', content: buildQuestionRecommendPrompt(background, text) },
      ], process.env.MAIN_MODEL);
      mainWindow?.webContents.send('ai-stream', responseText);
      mainWindow?.webContents.send('ai-stream-end', { citations: [] });
      return { success: true };
    }

    // Copilot mode: knowledge check → RAG
    const checkText = await queryChat([
      { role: 'user', content: buildKnowledgeCheckPrompt(text) },
    ]);

    if (checkText.startsWith('KNOWN:')) {
      await streamToRenderer([
        { role: 'system', content: '你是一位专业的面试助手，帮助面试者回答技术问题。请用中文回答，简洁有条理。' },
        { role: 'user', content: buildPrompt(background, text) },
      ]);
      mainWindow?.webContents.send('ai-stream-end', { citations: [] });
    } else {
      const ragResponse = await ragOrchestrator.processTranscript(text, background, { debug: true });
      const extractedQ = ragResponse.extractedQuestion?.question || text;
      mainWindow?.webContents.send('ai-question', extractedQ);

      if (ragResponse.debugTrace) {
        mainWindow?.webContents.send('rag-debug', ragResponse.debugTrace);
      }

      if (ragResponse.searchPerformed && ragResponse.context.combinedContext) {
        await streamToRenderer([
          { role: 'system', content: '你是一位专业的面试助手。基于提供的上下文和你的知识，给出最全面准确的回答。请用中文回答。' },
          { role: 'user', content: buildRAGPrompt(background, text, extractedQ, ragResponse.context.combinedContext) },
        ]);
        mainWindow?.webContents.send('ai-stream-end', { citations: ragResponse.context.citations });
      } else {
        await streamToRenderer([
          { role: 'system', content: '你是一位专业的面试助手，帮助面试者回答技术问题。请用中文回答，简洁有条理。' },
          { role: 'user', content: buildPrompt(background, text) },
        ]);
        mainWindow?.webContents.send('ai-stream-end', { citations: [] });
      }
    }

    return { success: true };
  } catch (err) {
    console.error('[AI] Completion error:', err);
    mainWindow?.webContents.send('ai-stream-end', { citations: [], error: err.message });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('upload-pdf', async () => {
  try {
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
      const text = fs.readFileSync(filePath, 'utf-8');
      const mdResult = await pineconeService.uploadMarkdown(text, filename);
      if (!mdResult) return { success: false, error: 'Markdown upload failed' };
      return { success: true, filename, title: mdResult.title, chunks: mdResult.chunks };
    }

    const buffer = fs.readFileSync(filePath);

    const send = (type, data) => {
      mainWindow?.webContents.send('pdf-agent-stream', type, data);
    };

    const agentResult = await resumeAnalyzer.process(buffer, filename, send);
    return agentResult;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-pdf', async (_event, filename) => {
  try {
    const success = await ragOrchestrator.deletePDF(filename);
    if (success) {
      uploadedPDFs = uploadedPDFs.filter(p => p.filename !== filename);
    }
    return { success };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('list-pdfs', async () => {
  const pdfs = pineconeService.getUploadedFiles();
  return { success: true, pdfs };
});

// --- 知识库管理 IPC ---

ipcMain.handle('list-chunks', async (_event, filters) => {
  try {
    const chunks = pineconeService.getChunks(filters || {});
    return { success: true, chunks };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-chunk', async (_event, id) => {
  try {
    const chunk = pineconeService.getChunkById(id);
    return chunk ? { success: true, chunk } : { success: false, error: 'Not found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update-chunk', async (_event, { id, updates }) => {
  try {
    const chunk = await pineconeService.updateChunk(id, updates);
    return chunk ? { success: true, chunk } : { success: false, error: 'Not found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-chunk', async (_event, id) => {
  try {
    const deleted = pineconeService.deleteChunk(id);
    return { success: true, deleted };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('add-chunk', async (_event, data) => {
  try {
    const chunk = await pineconeService.addChunk(data);
    return { success: true, chunk };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('list-groups', async () => {
  try {
    const groups = pineconeService.getGroups();
    return { success: true, groups };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-groups', async (_event, groups) => {
  try {
    pineconeService.saveGroups(groups);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('set-document-group', async (_event, { filename, group }) => {
  try {
    const count = pineconeService.setDocumentGroup(filename, group);
    return { success: true, count };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
