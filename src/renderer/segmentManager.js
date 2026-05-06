export function createSegmentManager({ elements, onRequestAI, onSegmentChange }) {
  const { transcriptArea } = elements;

  let segments = [];
  let selectedSegmentId = null;
  let segmentIdCounter = 0;

  const sourceState = new Map();

  function getSource(sourceId) {
    if (!sourceState.has(sourceId)) {
      sourceState.set(sourceId, { currentSegmentId: null, consumedText: '' });
    }
    return sourceState.get(sourceId);
  }

  function getSelectedText() {
    if (selectedSegmentId !== null) {
      const seg = segments.find(s => s.id === selectedSegmentId);
      if (seg) return seg.text;
    }
    if (segments.length > 0) return segments[segments.length - 1].text;
    return '';
  }

  function startNewSegment(sourceId = 'default') {
    const state = getSource(sourceId);
    const newSeg = { id: segmentIdCounter++, text: '', timestamp: new Date().toLocaleTimeString(), source: sourceId };
    segments.push(newSeg);
    state.currentSegmentId = newSeg.id;
    state.consumedText = '';
    emitSegmentChange('start', newSeg);
    render();
  }

  function finalizeCurrentSegment(sourceId = 'default') {
    const state = getSource(sourceId);
    if (state.currentSegmentId === null) return;
    const seg = segments.find(s => s.id === state.currentSegmentId);
    if (!seg || !seg.text.trim()) return;

    seg.finalized = true;
    state.consumedText += seg.text;
    emitSegmentChange('finalize', seg);

    const newSeg = { id: segmentIdCounter++, text: '', timestamp: new Date().toLocaleTimeString(), source: sourceId };
    segments.push(newSeg);
    state.currentSegmentId = newSeg.id;
    emitSegmentChange('start', newSeg);
    render();
  }

  function finalizeIfEmpty(sourceId) {
    if (sourceId !== undefined) {
      const state = getSource(sourceId);
      const idx = segments.findIndex(s => s.id === state.currentSegmentId);
      if (idx !== -1 && !segments[idx].text.trim()) segments.splice(idx, 1);
      state.currentSegmentId = null;
    } else {
      for (const [, state] of sourceState) {
        const idx = segments.findIndex(s => s.id === state.currentSegmentId);
        if (idx !== -1 && !segments[idx].text.trim()) segments.splice(idx, 1);
        state.currentSegmentId = null;
      }
    }
    render();
  }

  function updateCurrentSegment(fullText, sourceId = 'default', speakerId = null) {
    const state = getSource(sourceId);
    if (state.currentSegmentId === null) return;
    const seg = segments.find(s => s.id === state.currentSegmentId);
    if (!seg) return;

    if (speakerId !== null && seg.speaker !== undefined && seg.speaker !== null && seg.speaker !== speakerId && seg.text.trim()) {
      seg.finalized = true;
      state.consumedText += seg.text;
      emitSegmentChange('finalize', seg);

      const newSeg = { id: segmentIdCounter++, text: '', timestamp: new Date().toLocaleTimeString(), source: sourceId, speaker: speakerId };
      segments.push(newSeg);
      state.currentSegmentId = newSeg.id;
      emitSegmentChange('start', newSeg);
    }

    const current = segments.find(s => s.id === state.currentSegmentId);
    if (current) {
      current.text = fullText.length > state.consumedText.length ? fullText.substring(state.consumedText.length) : fullText;
      if (speakerId !== null) current.speaker = speakerId;
      emitSegmentChange('update', current);
    }
    render();
  }

  function clear() {
    segments = [];
    selectedSegmentId = null;
    sourceState.clear();
    render();
  }

  function isCurrentSegment(segId) {
    for (const [, state] of sourceState) {
      if (state.currentSegmentId === segId) return true;
    }
    return false;
  }

  function getSpeakerRole(seg) {
    if (seg.speaker !== undefined && seg.speaker !== null) {
      return seg.speaker === '0' ? 'me' : 'interviewer';
    }
    if (seg.source === 'mic') return 'me';
    if (seg.source === 'system') return 'interviewer';
    return null;
  }

  function emitSegmentChange(action, seg) {
    const role = getSpeakerRole(seg);
    onSegmentChange?.({
      action,
      id: seg.id,
      source: seg.source,
      speaker: role === 'interviewer' ? 'interviewer' : 'candidate',
      text: seg.text || '',
      timestamp: seg.timestamp,
      finalized: Boolean(seg.finalized),
    });
  }

  function render() {
    if (segments.length === 0 && sourceState.size === 0) {
      transcriptArea.innerHTML = '<div class="placeholder-text">点击下方按钮开始录音...</div>';
      return;
    }

    transcriptArea.innerHTML = '';
    for (const seg of segments) {
      const div = document.createElement('div');
      div.className = 'segment';
      if (seg.id === selectedSegmentId) div.classList.add('selected');
      const isCurrent = isCurrentSegment(seg.id);
      if (isCurrent && !seg.finalized) div.classList.add('recording');

      const role = getSpeakerRole(seg);
      if (role === 'me') div.classList.add('speaker-me');
      else if (role === 'interviewer') div.classList.add('speaker-interviewer');

      const header = document.createElement('div');
      header.className = 'segment-header';

      if (role) {
        const speaker = document.createElement('span');
        speaker.className = 'segment-speaker';
        speaker.textContent = role === 'me' ? '我' : '面试官';
        header.appendChild(speaker);
      }

      const time = document.createElement('span');
      time.className = 'segment-time';
      time.textContent = seg.timestamp;
      header.appendChild(time);

      if (seg.finalized && seg.text.trim()) {
        const aiBtn = document.createElement('button');
        aiBtn.className = 'segment-ai-btn';
        aiBtn.textContent = 'AI 回答';
        aiBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedSegmentId = seg.id;
          render();
          onRequestAI(seg.text);
        });
        header.appendChild(aiBtn);
      }

      const text = document.createElement('span');
      text.className = 'segment-text';
      if (seg.text) {
        text.textContent = seg.text;
      } else {
        text.innerHTML = '<span class="interim">识别中...</span>';
      }

      div.appendChild(header);
      div.appendChild(text);
      div.addEventListener('click', () => {
        if (isCurrent && !seg.finalized) return;
        selectedSegmentId = selectedSegmentId === seg.id ? null : seg.id;
        render();
      });
      transcriptArea.appendChild(div);
    }
    transcriptArea.scrollTop = transcriptArea.scrollHeight;
  }

  return { getSelectedText, startNewSegment, finalizeCurrentSegment, finalizeIfEmpty, updateCurrentSegment, clear, render };
}
