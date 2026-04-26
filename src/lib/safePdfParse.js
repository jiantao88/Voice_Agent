export async function safePdfParse(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const uint8 = new Uint8Array(buffer.buffer || buffer, buffer.byteOffset || 0, buffer.byteLength || buffer.length);
  const parser = new PDFParse(uint8);
  await parser.load();
  const result = await parser.getText();
  parser.destroy();

  const text = result.pages
    ? result.pages.map(p => p.text).join('\n')
    : String(result);

  return { text, numpages: result.pages?.length || 0 };
}
