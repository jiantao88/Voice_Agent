const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION_MS = 1500;

export function createAudioRecorder({ elements, segmentManager, electronAPI }) {
  const { recordBtn, recordLabel, statusText, langSelect, asrEngineSelect, audioDeviceSelect, systemAudioToggle } = elements;

  let isRecording = false;
  let mediaStream = null;
  let systemAudioStream = null;
  let audioContext = null;
  let scriptProcessor = null;
  let lastSpeechTime = 0;
  let silenceTimer = null;
  let hasSpokenInSegment = false;
  let captureSystemAudio = localStorage.getItem('capture-system-audio') === 'true';

  systemAudioToggle.addEventListener('change', () => {
    captureSystemAudio = systemAudioToggle.checked;
    localStorage.setItem('capture-system-audio', captureSystemAudio);
  });

  recordBtn.addEventListener('click', async () => {
    if (!isRecording) await start(); else await stop();
  });

  async function start() {
    try {
      const constraints = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } };
      const deviceId = audioDeviceSelect.value;
      if (deviceId) constraints.audio.deviceId = { exact: deviceId };

      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      await startStreaming();

      segmentManager.startNewSegment();
      lastSpeechTime = Date.now();
      hasSpokenInSegment = false;

      isRecording = true;
      recordBtn.classList.add('recording');
      recordLabel.textContent = '停止录音';
      statusText.textContent = '正在实时识别...';
    } catch (err) {
      statusText.textContent = `音频访问失败: ${err.message}`;
    }
  }

  async function stop() {
    await stopStreaming();
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }

    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (systemAudioStream) { systemAudioStream.getTracks().forEach(t => t.stop()); systemAudioStream = null; }

    segmentManager.finalizeIfEmpty();
    isRecording = false;
    recordBtn.classList.remove('recording');
    recordLabel.textContent = '开始录音';
    statusText.textContent = '';
  }

  async function startStreaming() {
    const result = await electronAPI.startStream({ lang: langSelect.value, asrEngine: asrEngineSelect.value });
    if (!result.success) throw new Error(result.error);

    audioContext = new AudioContext({ sampleRate: 16000 });
    const micSource = audioContext.createMediaStreamSource(mediaStream);
    const merger = audioContext.createChannelMerger(1);
    micSource.connect(merger, 0, 0);

    if (captureSystemAudio) {
      try {
        await electronAPI.enableLoopbackAudio();
        systemAudioStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        systemAudioStream.getVideoTracks().forEach(t => { t.stop(); systemAudioStream.removeTrack(t); });
        await electronAPI.disableLoopbackAudio();
        const sysSource = audioContext.createMediaStreamSource(systemAudioStream);
        sysSource.connect(merger, 0, 0);
        statusText.textContent = '正在实时识别（含系统音频）...';
      } catch (err) {
        console.warn('系统音频捕获失败，仅使用麦克风:', err.message);
        systemAudioStream = null;
      }
    }

    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    scriptProcessor.onaudioprocess = (e) => {
      const float32 = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
      const rms = Math.sqrt(sum / float32.length);

      if (rms > SILENCE_THRESHOLD) {
        lastSpeechTime = Date.now();
        hasSpokenInSegment = true;
        if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      } else if (hasSpokenInSegment && !silenceTimer) {
        silenceTimer = setTimeout(() => {
          silenceTimer = null;
          segmentManager.finalizeCurrentSegment();
          hasSpokenInSegment = false;
        }, SILENCE_DURATION_MS);
      }

      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      electronAPI.sendChunk(Array.from(int16), false);
    };

    merger.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);
  }

  async function stopStreaming() {
    if (scriptProcessor) { scriptProcessor.disconnect(); scriptProcessor = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
    await electronAPI.stopStream();
  }

  return {
    get isRecording() { return isRecording; },
    get captureSystemAudio() { return captureSystemAudio; },
  };
}
