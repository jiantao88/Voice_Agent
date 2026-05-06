import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { startLocal, feedAudioLocal, stopLocal } from './localASR.js';

// ============================================================
// 豆包流式语音识别 - 二进制协议
// ============================================================

const DOUBAO_CONFIG = {
  resourceId: 'volc.seedasr.sauc.duration',
  wsUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
  get apiKey() { return process.env.DOUBAO_API_KEY; },
};

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

function buildHeader(msgType, msgFlags, serialization, compression) {
  const byte0 = (PROTOCOL_VERSION << 4) | HEADER_SIZE;
  const byte1 = (msgType << 4) | msgFlags;
  const byte2 = (serialization << 4) | compression;
  return Buffer.from([byte0, byte1, byte2, 0x00]);
}

function buildFullClientRequest(lang) {
  const payload = {
    user: { uid: 'electron-vtt', did: os.hostname(), platform: `${process.platform}-electron` },
    audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      enable_ddc: false,
      result_type: 'full',
      show_utterances: true,
      enable_nonstream: true,
      enable_speaker_info: true,
      ssd_version: '200',
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
    if (hasSequence) offset += 4;
    const payloadSize = buf.readUInt32BE(offset);
    offset += 4;
    let payloadBuf = buf.subarray(offset, offset + payloadSize);
    if (compression === COMPRESS_GZIP) payloadBuf = zlib.gunzipSync(payloadBuf);
    const payload = JSON.parse(payloadBuf.toString('utf-8'));
    return { type: 'result', isLast, payload };
  }

  return null;
}

// ============================================================
// 多实例管理
// ============================================================

const instances = new Map();

function startDoubao(lang, onResult, onError) {
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
      console.log('[DOUBAO] WebSocket connected');
      ws.send(buildFullClientRequest(lang));
      resolve(ws);
    });

    ws.on('message', (data) => {
      const parsed = parseServerResponse(data);
      if (!parsed) return;

      if (parsed.type === 'error') {
        onError?.(`豆包 ASR 错误 [${parsed.code}]: ${parsed.message}`);
        return;
      }

      if (parsed.type === 'result') {
        const result = parsed.payload?.result;
        if (result) {
          const rawUtterances = result.utterances || [];
          if (rawUtterances.length > 0) {
            const sample = rawUtterances[0];
            console.log(`[DOUBAO] utterance[0] keys: ${Object.keys(sample).join(',')}, definite: ${sample.definite}, additions: ${JSON.stringify(sample.additions || 'none')}`);
          }
          const utterances = rawUtterances.map(u => ({
            text: u.text || '',
            definite: u.definite || false,
            speaker: u.additions?.speaker_id ?? u.additions?.speaker ?? null,
          }));
          const speakers = utterances.filter(u => u.speaker).map(u => `"${u.text.slice(0,10)}"→spk${u.speaker}`);
          if (speakers.length > 0) {
            console.log(`[DOUBAO-SSD] speakers: ${speakers.join(', ')}`);
          }
          onResult?.({
            text: result.text || '',
            utterances,
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
        onError?.(msg);
        reject(new Error(msg));
      });
    });

    ws.on('error', (err) => {
      onError?.(`WebSocket 错误: ${err.message}`);
      reject(err);
    });

    ws.on('close', () => {});
  });
}

function feedAudioDoubao(ws, chunkCount, pcmDataInt16, isLast) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return chunkCount;
  const int16 = Int16Array.from(pcmDataInt16);
  const pcmBuffer = Buffer.from(int16.buffer);
  if (chunkCount % 20 === 0) {
    console.log(`[DOUBAO] Sending chunk #${chunkCount}, bytes: ${pcmBuffer.length}, isLast: ${isLast}`);
  }
  ws.send(buildAudioPacket(pcmBuffer, isLast));
  return chunkCount + 1;
}

function stopDoubao(ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(buildAudioPacket(Buffer.alloc(0), true));
  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }, 2000);
}

// ============================================================
// ASR 引擎分发（多实例）
// ============================================================

export async function startASR(settings, onResult, onError, sourceId = 'default') {
  const engine = settings.asrEngine || 'doubao';
  console.log(`[ASR] Starting engine: ${engine} (source: ${sourceId})`);

  const inst = { engine, chunkCount: 0 };

  if (engine === 'local') {
    inst.local = startLocal(settings.lang, onResult, onError);
  } else {
    inst.ws = await startDoubao(settings.lang, onResult, onError);
  }

  instances.set(sourceId, inst);
}

export function feedAudio(pcmData, isLast, sourceId = 'default') {
  const inst = instances.get(sourceId);
  if (!inst) return;

  if (inst.engine === 'local') {
    feedAudioLocal(inst.local, pcmData, isLast);
  } else {
    inst.chunkCount = feedAudioDoubao(inst.ws, inst.chunkCount, pcmData, isLast);
  }
}

export function stopASR(sourceId = 'default') {
  const inst = instances.get(sourceId);
  if (!inst) return;

  console.log(`[ASR] Stopping engine: ${inst.engine} (source: ${sourceId})`);

  if (inst.engine === 'local') {
    stopLocal(inst.local);
  } else {
    stopDoubao(inst.ws);
  }

  instances.delete(sourceId);
}
