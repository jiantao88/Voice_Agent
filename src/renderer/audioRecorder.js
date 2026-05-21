const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION_MS = 1500;
const ASR_SAMPLE_RATE = 16000;

function downsample(float32, fromRate, toRate) {
  if (fromRate === toRate) return float32;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(float32.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = float32[Math.floor(i * ratio)];
  }
  return out;
}

export function createAudioRecorder({ elements, segmentManager, electronAPI, getActivePosition, getCurrentMode, onReviewComplete }) {
  const { recordBtn, recordLabel, statusText, langSelect, asrEngineSelect, audioDeviceSelect, systemAudioToggle } = elements;

  let isRecording = false;
  let mediaStream = null;
  let systemAudioStream = null;
  let micAudioContext = null;
  let sysAudioContext = null;
  let processors = [];
  let dualStream = false;
  let captureSystemAudio = localStorage.getItem('capture-system-audio') === 'true';
  let reviewSessionActive = false;
  let isStarting = false;
  let isStopping = false;

  const silenceState = {};
  const audioLevels = {};
  let statusLevelTimer = null;

  function resetSilence(sourceId) {
    silenceState[sourceId] = { lastSpeechTime: 0, silenceTimer: null, hasSpokenInSegment: false };
  }

  function clearAllSilence() {
    for (const key of Object.keys(silenceState)) {
      if (silenceState[key].silenceTimer) clearTimeout(silenceState[key].silenceTimer);
      delete silenceState[key];
    }
  }

  function startStatusLevelMonitor(label) {
    stopStatusLevelMonitor();
    statusLevelTimer = setInterval(() => {
      const micLevel = audioLevels.mic ?? audioLevels.default ?? 0;
      const systemLevel = audioLevels.system ?? 0;
      const micText = micLevel.toFixed(3);
      const systemText = systemLevel.toFixed(3);
      statusText.textContent = `${label} · 麦克风 ${micText} · 系统 ${systemText}`;
    }, 500);
  }

  function stopStatusLevelMonitor() {
    if (statusLevelTimer) clearInterval(statusLevelTimer);
    statusLevelTimer = null;
    for (const key of Object.keys(audioLevels)) delete audioLevels[key];
  }

  function createAudioHandler(sourceId, nativeSampleRate) {
    let handlerCallCount = 0;
    return (e) => {
      const raw = e.inputBuffer.getChannelData(0);
      const float32 = downsample(raw, nativeSampleRate, ASR_SAMPLE_RATE);

      let sum = 0;
      for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
      const rms = Math.sqrt(sum / float32.length);
      audioLevels[sourceId] = rms;

      if (handlerCallCount % 100 === 0) {
        console.log(`[AudioHandler:${sourceId}] call #${handlerCallCount}, rms=${rms.toFixed(6)}, samples=${float32.length}`);
      }
      handlerCallCount++;

      const state = silenceState[sourceId];
      if (!state) return;

      if (rms > SILENCE_THRESHOLD) {
        state.lastSpeechTime = Date.now();
        state.hasSpokenInSegment = true;
        if (state.silenceTimer) { clearTimeout(state.silenceTimer); state.silenceTimer = null; }
      } else if (state.hasSpokenInSegment && !state.silenceTimer) {
        state.silenceTimer = setTimeout(() => {
          state.silenceTimer = null;
          segmentManager.finalizeCurrentSegment(sourceId);
          state.hasSpokenInSegment = false;
        }, SILENCE_DURATION_MS);
      }

      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      electronAPI.sendChunk(Array.from(int16), false, sourceId);
    };
  }

  systemAudioToggle.addEventListener('change', () => {
    captureSystemAudio = systemAudioToggle.checked;
    localStorage.setItem('capture-system-audio', captureSystemAudio);
  });

  recordBtn.addEventListener('click', async () => {
    if (isStarting || isStopping) return;
    if (!isRecording) await start(); else await stop();
  });

  async function start() {
    isStarting = true;
    recordBtn.disabled = true;
    try {
      const constraints = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } };
      const deviceId = audioDeviceSelect.value;
      if (deviceId) constraints.audio.deviceId = { exact: deviceId };

      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      await electronAPI.startInterviewSession({
        position: getActivePosition?.() || '',
        mode: getCurrentMode?.() || 'candidate',
        captureSystemAudio,
        asrEngine: asrEngineSelect.value,
        lang: langSelect.value,
      });
      reviewSessionActive = true;
      await startStreaming();

      isRecording = true;
      recordBtn.classList.add('recording');
      recordLabel.textContent = '停止录音';
    } catch (err) {
      statusText.textContent = `音频访问失败: ${err.message}`;
      if (reviewSessionActive) {
        await electronAPI.endInterviewSession({ addToKnowledgeBase: false }).catch(() => null);
      }
      reviewSessionActive = false;
    } finally {
      isStarting = false;
      recordBtn.disabled = false;
    }
  }

  async function stop() {
    isStopping = true;
    recordBtn.disabled = true;
    let reviewStatusText = '';
    try {
      await stopStreaming();
      clearAllSilence();

      if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
      if (systemAudioStream) {
        systemAudioStream.getTracks().forEach(t => t.stop());
        systemAudioStream = null;
        await electronAPI.disableLoopbackAudio();
      }

      segmentManager.finalizeIfEmpty();
      if (reviewSessionActive) {
        statusText.textContent = '正在生成面试复盘...';
        const result = await electronAPI.endInterviewSession({ addToKnowledgeBase: true });
        reviewSessionActive = false;
        if (result.success && result.discarded) {
          reviewStatusText = result.message || '未生成复盘：没有识别到面试官问题';
          onReviewComplete?.(result);
        } else if (result.success) {
          const summary = result.review?.summary || {};
          reviewStatusText = `复盘完成：识别 ${summary.totalQuestions || 0} 个问题，薄弱 ${summary.weakQuestionCount || 0} 个，入库 ${result.knowledgeCount || 0} 条`;
          onReviewComplete?.(result);
        } else {
          reviewStatusText = `复盘失败：${result.error || '未知错误'}`;
        }
      }
    } finally {
      isStopping = false;
      recordBtn.disabled = false;
    }
    isRecording = false;
    dualStream = false;
    recordBtn.classList.remove('recording');
    recordLabel.textContent = '开始录音';
    statusText.textContent = reviewStatusText;
  }

  async function startStreaming() {
    const baseSettings = { lang: langSelect.value, asrEngine: asrEngineSelect.value };

    let sysSource = null;
    let sysSampleRate = ASR_SAMPLE_RATE;

    if (captureSystemAudio) {
      try {
        await electronAPI.enableLoopbackAudio();
        systemAudioStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        for (const track of systemAudioStream.getVideoTracks()) {
          track.enabled = false;
        }
        await electronAPI.disableLoopbackAudio();

        const audioTracks = systemAudioStream.getAudioTracks();
        console.log('[DualStream] System audio tracks:', audioTracks.length);
        if (audioTracks.length === 0) {
          throw new Error('没有获取到系统音频轨道');
        }
        if (audioTracks.length > 0) {
          const t = audioTracks[0];
          console.log(`[DualStream] Track state: ${t.readyState}, muted: ${t.muted}, enabled: ${t.enabled}`);
          console.log(`[DualStream] Track settings:`, JSON.stringify(t.getSettings()));
          t.addEventListener('ended', () => console.warn('[DualStream] System audio track ENDED'));
          t.addEventListener('mute', () => console.warn('[DualStream] System audio track MUTED'));
          t.addEventListener('unmute', () => console.log('[DualStream] System audio track UNMUTED'));
        }

        sysAudioContext = new AudioContext();
        sysSampleRate = sysAudioContext.sampleRate;
        sysSource = sysAudioContext.createMediaStreamSource(systemAudioStream);
      } catch (err) {
        console.warn('系统音频捕获失败，仅使用麦克风:', err.message);
        if (systemAudioStream) {
          systemAudioStream.getTracks().forEach(t => t.stop());
        }
        systemAudioStream = null;
        if (sysAudioContext) { sysAudioContext.close(); sysAudioContext = null; }
        await electronAPI.disableLoopbackAudio().catch(() => null);
      }
    }

    micAudioContext = new AudioContext({ sampleRate: ASR_SAMPLE_RATE });
    const micSource = micAudioContext.createMediaStreamSource(mediaStream);

    if (sysSource) {
      dualStream = true;

      await electronAPI.startStream({ ...baseSettings, sourceId: 'mic' });
      await electronAPI.startStream({ ...baseSettings, sourceId: 'system' });

      resetSilence('mic');
      resetSilence('system');

      const micProcessor = micAudioContext.createScriptProcessor(4096, 1, 1);
      micProcessor.onaudioprocess = createAudioHandler('mic', ASR_SAMPLE_RATE);
      micSource.connect(micProcessor);
      micProcessor.connect(micAudioContext.destination);

      const sysProcessor = sysAudioContext.createScriptProcessor(4096, 1, 1);
      sysProcessor.onaudioprocess = createAudioHandler('system', sysSampleRate);
      sysSource.connect(sysProcessor);
      const silentGain = sysAudioContext.createGain();
      silentGain.gain.value = 0;
      sysProcessor.connect(silentGain);
      silentGain.connect(sysAudioContext.destination);

      processors = [micProcessor, sysProcessor];

      segmentManager.startNewSegment('mic');
      segmentManager.startNewSegment('system');
      silenceState['mic'].hasSpokenInSegment = false;
      silenceState['system'].hasSpokenInSegment = false;

      statusText.textContent = '正在实时识别（含系统音频 · 说话人分离）...';
      startStatusLevelMonitor('正在实时识别（含系统音频 · 说话人分离）');
    } else {
      dualStream = false;

      const result = await electronAPI.startStream(baseSettings);
      if (!result.success) throw new Error(result.error);

      resetSilence('default');

      const processor = micAudioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = createAudioHandler('default', ASR_SAMPLE_RATE);

      micSource.connect(processor);
      processor.connect(micAudioContext.destination);

      processors = [processor];

      segmentManager.startNewSegment();
      silenceState['default'].lastSpeechTime = Date.now();
      silenceState['default'].hasSpokenInSegment = false;

      statusText.textContent = captureSystemAudio
        ? '正在实时识别（系统音频捕获失败，仅麦克风）...'
        : '正在实时识别...';
      startStatusLevelMonitor(statusText.textContent);
    }
  }

  async function stopStreaming() {
    stopStatusLevelMonitor();
    for (const p of processors) p.disconnect();
    processors = [];
    if (micAudioContext) { micAudioContext.close(); micAudioContext = null; }
    if (sysAudioContext) { sysAudioContext.close(); sysAudioContext = null; }

    if (dualStream) {
      await electronAPI.stopStream('mic');
      await electronAPI.stopStream('system');
    } else {
      await electronAPI.stopStream();
    }
  }

  return {
    get isRecording() { return isRecording; },
    get captureSystemAudio() { return captureSystemAudio; },
  };
}
