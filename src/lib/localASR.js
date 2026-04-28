import { checkModel } from './modelDownloader.js';

let recognizer = null;
let stream = null;
let resultCallback = null;
let errorCallback = null;
let chunkCount = 0;

export function startLocal(lang, onResult, onError) {
  const sherpaOnnx = require('sherpa-onnx-node');

  const { available, modelDir } = checkModel();
  if (!available) {
    throw new Error('本地 ASR 模型未下载，请先在设置中下载模型');
  }

  const config = {
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig: {
      paraformer: {
        encoder: `${modelDir}/encoder.int8.onnx`,
        decoder: `${modelDir}/decoder.int8.onnx`,
      },
      tokens: `${modelDir}/tokens.txt`,
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
  };

  recognizer = new sherpaOnnx.OnlineRecognizer(config);
  stream = recognizer.createStream();
  resultCallback = onResult;
  errorCallback = onError;
  chunkCount = 0;

  console.log('[LocalASR] Started');
}

export function feedAudioLocal(pcmDataInt16, isLast) {
  if (!recognizer || !stream) return;

  try {
    if (pcmDataInt16.length > 0) {
      const float32 = new Float32Array(pcmDataInt16.length);
      for (let i = 0; i < pcmDataInt16.length; i++) {
        float32[i] = pcmDataInt16[i] / 32768.0;
      }

      stream.acceptWaveform({ sampleRate: 16000, samples: float32 });

      while (recognizer.isReady(stream)) {
        recognizer.decode(stream);
      }

      const result = recognizer.getResult(stream);
      const text = result.text?.trim() || '';

      if (text) {
        if (chunkCount % 20 === 0) {
          console.log(`[LocalASR] chunk #${chunkCount}, text: "${text.substring(0, 50)}"`);
        }
        chunkCount++;

        const isEndpoint = recognizer.isEndpoint(stream);

        resultCallback?.({
          text,
          utterances: [{ text, definite: isEndpoint }],
          isLast: false,
        });

        if (isEndpoint) {
          recognizer.reset(stream);
        }
      }
    }

    if (isLast) {
      while (recognizer.isReady(stream)) {
        recognizer.decode(stream);
      }

      const finalResult = recognizer.getResult(stream);
      const finalText = finalResult.text?.trim() || '';

      if (finalText) {
        resultCallback?.({
          text: finalText,
          utterances: [{ text: finalText, definite: true }],
          isLast: true,
        });
      }

      stopLocal();
    }
  } catch (err) {
    console.error('[LocalASR] feedAudio error:', err);
    errorCallback?.(`本地识别错误: ${err.message}`);
  }
}

export function stopLocal() {
  if (stream) {
    try {
      stream.free?.();
    } catch (_) {}
    stream = null;
  }
  resultCallback = null;
  errorCallback = null;
  console.log('[LocalASR] Stopped');
}
