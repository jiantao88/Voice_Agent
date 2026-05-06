import { afterEach, describe, expect, it, vi } from 'vitest';

describe('generateEmbedding', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('uses dedicated embedding endpoint, key, and model when configured', async () => {
    process.env.EMBEDDING_BASE_URL = 'https://aihubmix.com/v1';
    process.env.EMBEDDING_API_KEY = 'embedding-test-key';
    process.env.EMBEDDING_MODEL = 'text-embedding-3-small';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { generateEmbedding } = await import('../src/lib/gemini.js');
    const embedding = await generateEmbedding('React Hooks');

    expect(embedding).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://aihubmix.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer embedding-test-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ model: 'text-embedding-3-small', input: 'React Hooks' }),
      }),
    );
  });
});
