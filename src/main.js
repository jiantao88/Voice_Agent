import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { config as dotenvConfig } from 'dotenv';
import started from 'electron-squirrel-startup';
import WebSocket from 'ws';

dotenvConfig({ path: path.join(app.getAppPath(), '.env') });

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
      if (permission === 'media') {
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
// 豆包流式语音识别 - 二进制协议实现
// ============================================================

const DOUBAO_CONFIG = {
  apiKey: process.env.DOUBAO_API_KEY,
  resourceId: 'volc.seedasr.sauc.duration',
  wsUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
};

console.log('[DOUBAO] apiKey loaded:', DOUBAO_CONFIG.apiKey ? `${DOUBAO_CONFIG.apiKey.substring(0, 8)}...` : 'EMPTY');

// 协议常量
const PROTOCOL_VERSION = 0b0001;
const HEADER_SIZE = 0b0001;
const MSG_FULL_CLIENT_REQUEST = 0b0001;
const MSG_AUDIO_ONLY = 0b0010;
const MSG_FULL_SERVER_RESPONSE = 0b1001;
const MSG_ERROR_RESPONSE = 0b1111;
const FLAG_NONE = 0b0000;
const FLAG_LAST_PACKET = 0b0010;
const SERIAL_JSON = 0b0001;
const SERIAL_NONE = 0b0000;
const COMPRESS_GZIP = 0b0001;
const COMPRESS_NONE = 0b0000;

function buildHeader(msgType, msgFlags, serialization, compression) {
  const byte0 = (PROTOCOL_VERSION << 4) | HEADER_SIZE;
  const byte1 = (msgType << 4) | msgFlags;
  const byte2 = (serialization << 4) | compression;
  const byte3 = 0x00;
  return Buffer.from([byte0, byte1, byte2, byte3]);
}

function buildFullClientRequest(lang) {
  const payload = {
    user: {
      uid: 'electron-vtt',
      did: os.hostname(),
      platform: `${process.platform}-electron`,
    },
    audio: {
      format: 'pcm',
      codec: 'raw',
      rate: 16000,
      bits: 16,
      channel: 1,
    },
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      enable_ddc: false,
      result_type: 'full',
    },
  };

  if (lang && lang !== 'auto') {
    payload.audio.language = lang === 'zh' ? 'zh-CN' : lang === 'en' ? 'en-US' : undefined;
  }

  const jsonBuf = Buffer.from(JSON.stringify(payload), 'utf-8');
  const compressed = zlib.gzipSync(jsonBuf);

  const header = buildHeader(MSG_FULL_CLIENT_REQUEST, FLAG_NONE, SERIAL_JSON, COMPRESS_GZIP);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(compressed.length, 0);

  return Buffer.concat([header, sizeBuf, compressed]);
}

function buildAudioPacket(pcmBuffer, isLast) {
  const flags = isLast ? FLAG_LAST_PACKET : FLAG_NONE;
  const compressed = zlib.gzipSync(pcmBuffer);

  const header = buildHeader(MSG_AUDIO_ONLY, flags, SERIAL_NONE, COMPRESS_GZIP);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(compressed.length, 0);

  return Buffer.concat([header, sizeBuf, compressed]);
}

function parseServerResponse(data) {
  const buf = Buffer.from(data);
  if (buf.length < 4) return null;

  const byte1 = buf[1];
  const msgType = (byte1 >> 4) & 0x0f;
  const msgFlags = byte1 & 0x0f;
  const byte2 = buf[2];
  const compression = byte2 & 0x0f;

  if (msgType === MSG_ERROR_RESPONSE) {
    const errorCode = buf.readUInt32BE(4);
    const msgSize = buf.readUInt32BE(8);
    const errorMsg = buf.subarray(12, 12 + msgSize).toString('utf-8');
    return { type: 'error', code: errorCode, message: errorMsg };
  }

  if (msgType === MSG_FULL_SERVER_RESPONSE) {
    const isLast = (msgFlags & 0b0010) !== 0;
    const hasSequence = (msgFlags & 0b0001) !== 0;

    let offset = 4;
    if (hasSequence) {
      offset += 4; // skip sequence number
    }

    const payloadSize = buf.readUInt32BE(offset);
    offset += 4;
    let payloadBuf = buf.subarray(offset, offset + payloadSize);

    if (compression === COMPRESS_GZIP) {
      payloadBuf = zlib.gunzipSync(payloadBuf);
    }

    const payload = JSON.parse(payloadBuf.toString('utf-8'));
    return { type: 'result', isLast, payload };
  }

  return null;
}

// WebSocket 连接管理
let wsConnection = null;

function startDoubaoStream(lang) {
  return new Promise((resolve, reject) => {
    const connectId = crypto.randomUUID();

    const ws = new WebSocket(DOUBAO_CONFIG.wsUrl, {
      headers: {
        'X-Api-Key': DOUBAO_CONFIG.apiKey,
        'X-Api-Resource-Id': DOUBAO_CONFIG.resourceId,
        'X-Api-Connect-Id': connectId,
      },
    });

    ws.binaryType = 'arraybuffer';

    ws.on('open', () => {
      console.log('[DOUBAO] WebSocket connected, sending full client request');
      const fullClientRequest = buildFullClientRequest(lang);
      ws.send(fullClientRequest);
      wsConnection = ws;
      resolve();
    });

    ws.on('message', (data) => {
      console.log('[DOUBAO] Received message, size:', Buffer.from(data).length);
      const parsed = parseServerResponse(data);
      if (!parsed) {
        console.log('[DOUBAO] Could not parse response');
        return;
      }
      console.log('[DOUBAO] Parsed type:', parsed.type, parsed.type === 'result' ? JSON.stringify(parsed.payload).substring(0, 200) : '');

      if (parsed.type === 'error') {
        mainWindow?.webContents.send('stream-error', `豆包 ASR 错误 [${parsed.code}]: ${parsed.message}`);
        return;
      }

      if (parsed.type === 'result') {
        const result = parsed.payload?.result;
        if (result) {
          console.log('[DOUBAO] utterances:', JSON.stringify(result.utterances?.map(u => ({ text: u.text?.substring(0, 30), definite: u.definite }))));
          mainWindow?.webContents.send('stream-result', {
            text: result.text || '',
            utterances: result.utterances || [],
            isLast: parsed.isLast,
          });
        }
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk.toString(); });
      res.on('end', () => {
        const msg = `WebSocket 握手失败 [${res.statusCode}]: ${body}`;
        console.error(msg);
        mainWindow?.webContents.send('stream-error', msg);
        wsConnection = null;
        reject(new Error(msg));
      });
    });

    ws.on('error', (err) => {
      mainWindow?.webContents.send('stream-error', `WebSocket 错误: ${err.message}`);
      wsConnection = null;
      reject(err);
    });

    ws.on('close', () => {
      wsConnection = null;
    });
  });
}

let chunkCount = 0;

function sendAudioChunk(pcmData, isLast) {
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return;
  const int16 = Int16Array.from(pcmData);
  const pcmBuffer = Buffer.from(int16.buffer);
  if (chunkCount % 20 === 0) {
    console.log(`[DOUBAO] Sending chunk #${chunkCount}, pcm bytes: ${pcmBuffer.length}, isLast: ${isLast}`);
  }
  chunkCount++;
  const packet = buildAudioPacket(pcmBuffer, isLast);
  wsConnection.send(packet);
}

function stopDoubaoStream() {
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return;
  const emptyPacket = buildAudioPacket(Buffer.alloc(0), true);
  wsConnection.send(emptyPacket);
  setTimeout(() => {
    if (wsConnection) {
      wsConnection.close();
      wsConnection = null;
    }
  }, 2000);
}

// ============================================================
// IPC Handlers
// ============================================================

ipcMain.handle('start-doubao-stream', async (_event, settings) => {
  try {
    await startDoubaoStream(settings.lang);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('send-audio-chunk', async (_event, pcmData, isLast) => {
  try {
    sendAudioChunk(pcmData, isLast);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-doubao-stream', async () => {
  try {
    stopDoubaoStream();
    return { success: true };
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
      const ragResponse = await ragOrchestrator.processTranscript(text, background);
      const extractedQ = ragResponse.extractedQuestion?.question || text;
      mainWindow?.webContents.send('ai-question', extractedQ);

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
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };

    const filePath = result.filePaths[0];
    const filename = path.basename(filePath);
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
