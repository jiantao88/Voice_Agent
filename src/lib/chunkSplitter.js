export function splitPdfIntoChunks(pdfData, chunkSize = 150) {
  const text = pdfData.text.replace(/\n{3,}/g, '\n\n').replace(/\s{3,}/g, ' ').trim();
  const sentences = text.split(/[.!?。！？]+/).filter(s => s.trim().length > 0);
  const chunks = [];
  const avgCharsPerPage = Math.ceil(text.length / (pdfData.numpages || 1));

  let currentChunk = '';
  let currentWordCount = 0;
  let chunkStartPos = 0;

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).length;
    const sentenceText = sentence.trim() + '. ';

    if (currentWordCount + words > chunkSize && currentChunk.length > 0) {
      const chunkEnd = chunkStartPos + currentChunk.length;
      chunks.push({
        content: currentChunk.trim(),
        page: Math.max(1, Math.ceil(chunkStartPos / avgCharsPerPage)),
        startPage: Math.max(1, Math.ceil(chunkStartPos / avgCharsPerPage)),
        endPage: Math.min(pdfData.numpages || 1, Math.ceil(chunkEnd / avgCharsPerPage)),
      });
      chunkStartPos = chunkEnd;
      currentChunk = sentenceText;
      currentWordCount = words;
    } else {
      currentChunk += sentenceText;
      currentWordCount += words;
    }
  }

  if (currentChunk.trim().length > 0) {
    const chunkEnd = chunkStartPos + currentChunk.length;
    chunks.push({
      content: currentChunk.trim(),
      page: Math.max(1, Math.ceil(chunkStartPos / avgCharsPerPage)),
      startPage: Math.max(1, Math.ceil(chunkStartPos / avgCharsPerPage)),
      endPage: Math.min(pdfData.numpages || 1, Math.ceil(chunkEnd / avgCharsPerPage)),
    });
  }

  return chunks;
}

export function splitMarkdownByHeadings(text) {
  const lines = text.split('\n');
  const chunks = [];
  let currentHeading = '';
  let currentContent = '';

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)/);
    if (match) {
      if (currentContent.trim()) {
        chunks.push({ heading: currentHeading, content: currentHeading ? `${currentHeading}\n${currentContent.trim()}` : currentContent.trim() });
      }
      currentHeading = line;
      currentContent = '';
    } else {
      currentContent += line + '\n';
    }
  }
  if (currentContent.trim()) {
    chunks.push({ heading: currentHeading, content: currentHeading ? `${currentHeading}\n${currentContent.trim()}` : currentContent.trim() });
  }
  return chunks;
}
