import { checkModel } from './modelDownloader.js';

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

  const recognizer = new sherpaOnnx.OnlineRecognizer(config);
  const stream = recognizer.createStream();

  const instance = { recognizer, stream, resultCallback: onResult, errorCallback: onError, chunkCount: 0 };
  console.log('[LocalASR] Started');
  return instance;
}

export function feedAudioLocal(instance, pcmDataInt16, isLast) {
  if (!instance || !instance.recognizer || !instance.stream) return;
  const { recognizer, stream } = instance;

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
        if (instance.chunkCount % 20 === 0) {
          console.log(`[LocalASR] chunk #${instance.chunkCount}, text: "${text.substring(0, 50)}"`);
        }
        instance.chunkCount++;

        const isEndpoint = recognizer.isEndpoint(stream);

        instance.resultCallback?.({
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
        instance.resultCallback?.({
          text: finalText,
          utterances: [{ text: finalText, definite: true }],
          isLast: true,
        });
      }

      stopLocal(instance);
    }
  } catch (err) {
    console.error('[LocalASR] feedAudio error:', err);
    instance.errorCallback?.(`本地识别错误: ${err.message}`);
  }
}

export function stopLocal(instance) {
  if (!instance) return;
  if (instance.stream) {
    try {
      instance.stream.free?.();
    } catch (_) {}
    instance.stream = null;
  }
  instance.resultCallback = null;
  instance.errorCallback = null;
  console.log('[LocalASR] Stopped');
}
