import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { exec } from 'node:child_process';

const MODEL_DIR_NAME = 'paraformer-bilingual';
const ARCHIVE_FILENAME = 'sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2';
const DOWNLOAD_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${ARCHIVE_FILENAME}`;

const REQUIRED_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt'];

function getModelsDir() {
  return path.join(app.getPath('userData'), 'models');
}

function getModelDir() {
  return path.join(getModelsDir(), MODEL_DIR_NAME);
}

export function checkModel() {
  const modelDir = getModelDir();
  if (!fs.existsSync(modelDir)) {
    return { available: false, modelDir };
  }
  for (const file of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(modelDir, file))) {
      return { available: false, modelDir };
    }
  }
  return { available: true, modelDir };
}

function followRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        followRedirects(res.headers.location, maxRedirects - 1).then(resolve, reject);
      } else if (res.statusCode === 200) {
        resolve(res);
      } else {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });
    req.on('error', reject);
  });
}

export async function downloadModel(onProgress) {
  const modelsDir = getModelsDir();
  const modelDir = getModelDir();
  const archivePath = path.join(modelsDir, ARCHIVE_FILENAME);

  fs.mkdirSync(modelsDir, { recursive: true });

  onProgress?.({ stage: 'download', percent: 0, message: '正在连接下载服务器...' });

  const res = await followRedirects(DOWNLOAD_URL);
  const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
  let downloadedBytes = 0;

  const fileStream = createWriteStream(archivePath);

  res.on('data', (chunk) => {
    downloadedBytes += chunk.length;
    const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
    onProgress?.({
      stage: 'download',
      percent,
      downloaded: downloadedBytes,
      total: totalBytes,
      message: `下载中... ${(downloadedBytes / 1024 / 1024).toFixed(1)}MB / ${(totalBytes / 1024 / 1024).toFixed(1)}MB`,
    });
  });

  await pipeline(res, fileStream);

  onProgress?.({ stage: 'extract', percent: 0, message: '正在解压模型文件...' });

  fs.mkdirSync(modelDir, { recursive: true });

  await new Promise((resolve, reject) => {
    const cmd = `tar -xjf "${archivePath}" -C "${modelsDir}"`;
    exec(cmd, (err) => {
      if (err) return reject(new Error(`解压失败: ${err.message}`));
      resolve();
    });
  });

  onProgress?.({ stage: 'extract', percent: 50, message: '正在整理模型文件...' });

  const extractedDir = path.join(modelsDir, 'sherpa-onnx-streaming-paraformer-bilingual-zh-en');
  if (fs.existsSync(extractedDir)) {
    for (const file of REQUIRED_FILES) {
      const src = path.join(extractedDir, file);
      const dst = path.join(modelDir, file);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
    }
    fs.rmSync(extractedDir, { recursive: true, force: true });
  }

  if (fs.existsSync(archivePath)) {
    fs.unlinkSync(archivePath);
  }

  onProgress?.({ stage: 'extract', percent: 100, message: '模型准备完成' });

  const check = checkModel();
  if (!check.available) {
    throw new Error('模型文件解压后验证失败，缺少必要文件');
  }

  return check;
}
