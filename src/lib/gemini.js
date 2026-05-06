import OpenAI from 'openai';

let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.LLM_API_KEY || '';
    const baseURL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
    console.log('[AI] Creating OpenAI client, baseURL:', baseURL, 'apiKey:', apiKey ? apiKey.substring(0, 8) + '...' : 'EMPTY');
    client = new OpenAI({ apiKey, baseURL });
  }
  return client;
}

export default getClient;

export async function streamChat(messages, model) {
  return getClient().chat.completions.create({
    model: model || process.env.MAIN_MODEL || 'vtrix-gemini-3-flash-preview',
    messages,
    stream: true,
    max_tokens: 2048,
  });
}

export async function queryChat(messages, model) {
  const useModel = model || process.env.FAST_MODEL || 'vtrix-gemini-3-flash-preview';
  console.log('[AI] queryChat model:', useModel);
  const response = await getClient().chat.completions.create({
    model: useModel,
    messages,
    max_tokens: 1024,
  });
  return response.choices[0]?.message?.content || '';
}

export async function generateEmbedding(text) {
  const apiKey = process.env.EMBEDDING_API_KEY || process.env.LLM_API_KEY || '';
  const baseURL = (process.env.EMBEDDING_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
  const response = await fetch(`${baseURL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input: text }),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || `Embedding request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = data?.error?.code;
    throw error;
  }
  return data.data?.[0]?.embedding || [];
}
