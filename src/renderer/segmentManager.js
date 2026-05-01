export function createSegmentManager({ elements, onRequestAI }) {
  const { transcriptArea } = elements;

  let segments = [];
  let currentSegmentId = null;
  let selectedSegmentId = null;
  let segmentIdCounter = 0;
  let consumedText = '';

  function getSelectedText() {
    if (selectedSegmentId !== null) {
      const seg = segments.find(s => s.id === selectedSegmentId);
      if (seg) return seg.text;
    }
    if (segments.length > 0) return segments[segments.length - 1].text;
    return '';
  }

  function startNewSegment() {
    const newSeg = { id: segmentIdCounter++, text: '', timestamp: new Date().toLocaleTimeString() };
    segments.push(newSeg);
    currentSegmentId = newSeg.id;
    consumedText = '';
    render();
  }

  function finalizeCurrentSegment() {
    if (currentSegmentId === null) return;
    const seg = segments.find(s => s.id === currentSegmentId);
    if (!seg || !seg.text.trim()) return;

    seg.finalized = true;
    consumedText += seg.text;

    const newSeg = { id: segmentIdCounter++, text: '', timestamp: new Date().toLocaleTimeString() };
    segments.push(newSeg);
    currentSegmentId = newSeg.id;
    render();
  }

  function finalizeIfEmpty() {
    const idx = segments.findIndex(s => s.id === currentSegmentId);
    if (idx !== -1 && !segments[idx].text.trim()) segments.splice(idx, 1);
    currentSegmentId = null;
    render();
  }

  function updateCurrentSegment(fullText) {
    if (currentSegmentId === null) return;
    const seg = segments.find(s => s.id === currentSegmentId);
    if (seg) {
      seg.text = fullText.length > consumedText.length ? fullText.substring(consumedText.length) : fullText;
    }
    render();
  }

  function clear() {
    segments = [];
    currentSegmentId = null;
    selectedSegmentId = null;
    render();
  }

  function render() {
    if (segments.length === 0 && !currentSegmentId) {
      transcriptArea.innerHTML = '<div class="placeholder-text">点击下方按钮开始录音...</div>';
      return;
    }

    transcriptArea.innerHTML = '';
    for (const seg of segments) {
      const div = document.createElement('div');
      div.className = 'segment';
      if (seg.id === selectedSegmentId) div.classList.add('selected');
      if (seg.id === currentSegmentId && !seg.finalized) div.classList.add('recording');

      const header = document.createElement('div');
      header.className = 'segment-header';
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
        if (seg.id === currentSegmentId && !seg.finalized) return;
        selectedSegmentId = selectedSegmentId === seg.id ? null : seg.id;
        render();
      });
      transcriptArea.appendChild(div);
    }
    transcriptArea.scrollTop = transcriptArea.scrollHeight;
  }

  return { getSelectedText, startNewSegment, finalizeCurrentSegment, finalizeIfEmpty, updateCurrentSegment, clear, render };
}
